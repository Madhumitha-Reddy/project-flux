package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	application "github.com/flux-pkm/server/internal/app"
	"github.com/flux-pkm/server/internal/domain"
	"github.com/flux-pkm/server/internal/vault"
	"github.com/gin-gonic/gin"
)

func TestOpenUserSelectedVault(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manager := vault.NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	router := gin.New()
	RegisterRoutes(router, application.NewService(manager))

	body, err := json.Marshal(map[string]string{"path": t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/vaults/open", strings.NewReader(string(body)))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status %d: %s", response.Code, response.Body.String())
	}
	var info domain.VaultInfo
	if err := json.Unmarshal(response.Body.Bytes(), &info); err != nil || info.ID == "" {
		t.Fatalf("invalid vault response: %#v, %v", info, err)
	}
}

func TestCreateVault(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manager := vault.NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	router := gin.New()
	RegisterRoutes(router, application.NewService(manager))

	root := filepath.Join(t.TempDir(), "created-vault")
	body, err := json.Marshal(map[string]string{"path": root})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/vaults/create", strings.NewReader(string(body)))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("unexpected status %d: %s", response.Code, response.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, ".flux", "vault.json")); err != nil {
		t.Fatalf("vault identity was not created: %v", err)
	}
}

func TestRawFileAndWatcherRevision(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	pdf := []byte("%PDF-1.4\nraw-test")
	if err := os.WriteFile(filepath.Join(root, "test.pdf"), pdf, 0o600); err != nil {
		t.Fatal(err)
	}
	manager := vault.NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	service := application.NewService(manager)
	info, err := service.OpenVault(root)
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	RegisterRoutes(router, service)

	rawRequest := httptest.NewRequest(http.MethodGet, "/api/v1/vaults/"+info.ID+"/files/raw?path=test.pdf", nil)
	rawResponse := httptest.NewRecorder()
	router.ServeHTTP(rawResponse, rawRequest)
	if rawResponse.Code != http.StatusOK || !bytes.Equal(rawResponse.Body.Bytes(), pdf) {
		t.Fatalf("unexpected raw response %d: %q", rawResponse.Code, rawResponse.Body.Bytes())
	}

	revision := func() uint64 {
		request := httptest.NewRequest(http.MethodGet, "/api/v1/vaults/"+info.ID+"/revision", nil)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("unexpected revision status %d", response.Code)
		}
		var body struct {
			Revision uint64 `json:"revision"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body.Revision
	}
	before := revision()
	changed := make(chan uint64, 1)
	go func() {
		waitContext, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		next, _ := service.WaitVaultRevision(waitContext, info.ID, before)
		changed <- next
	}()
	if err := os.WriteFile(filepath.Join(root, "external.pdf"), pdf, 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case next := <-changed:
		if next == 0 || next == before {
			t.Fatalf("watcher revision did not advance: %d", next)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("watcher did not signal after revision advanced")
	}
}
