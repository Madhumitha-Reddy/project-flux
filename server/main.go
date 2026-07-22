package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/flux-pkm/server/internal/api"
	application "github.com/flux-pkm/server/internal/app"
	"github.com/flux-pkm/server/internal/appdata"
	"github.com/flux-pkm/server/internal/config"
	"github.com/flux-pkm/server/internal/vault"
	"github.com/gin-gonic/gin"
)

func main() {
	// Load configuration
	cfg := config.Load()

	// The server starts without touching a vault. Persistent state is initialized
	// only after OpenVault succeeds for the configured vault path.
	allowAnyVaultPath := (cfg.Environment == "development" || cfg.Environment == "desktop") &&
		(cfg.Host == "localhost" || net.ParseIP(cfg.Host).IsLoopback())
	vaultManager := vault.NewManager(cfg.VaultPath, allowAnyVaultPath)
	if cfg.VaultRoot != "" && cfg.VaultPath == "" {
		vaultManager = vault.NewStorageManager(cfg.VaultRoot)
	}
	defer func() {
		if err := vaultManager.Close(); err != nil {
			log.Printf("Failed to close vault: %v", err)
		}
	}()
	appService := application.NewService(vaultManager)
	appData, err := appdata.Open(filepath.Join(cfg.AppDataDir, "app.db"))
	if err != nil {
		log.Fatalf("Failed to open app data: %v", err)
	}
	defer func() {
		if err := appData.Close(); err != nil {
			log.Printf("Failed to close app data: %v", err)
		}
	}()

	// Set Gin mode
	if cfg.Environment == "production" || cfg.Environment == "desktop" {
		gin.SetMode(gin.ReleaseMode)
	}

	// Create router
	router := gin.Default()

	// Setup CORS for the browser shell. Electron uses its preload bridge.
	router.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", cfg.AllowedOrigin)
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, X-Flux-Desktop-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, PATCH, DELETE")
		c.Writer.Header().Set("Vary", "Origin")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	// Register API routes
	api.RegisterRoutes(router, appService, api.WithAppData(appData), api.WithDesktopToken(cfg.DesktopToken))

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, appService.Status())
	})

	// Start server
	address := cfg.Host + ":" + cfg.Port
	log.Printf("Starting FLUX server on %s", address)
	server := &http.Server{Addr: address, Handler: router, ReadHeaderTimeout: 10 * time.Second}
	failed := make(chan error, 1)
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			failed <- err
		}
		close(failed)
	}()
	shutdownSignal, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case err := <-failed:
		if err != nil {
			log.Fatalf("Failed to start server: %v", err)
		}
	case <-shutdownSignal.Done():
		shutdownContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownContext); err != nil {
			log.Printf("Failed to shut down server cleanly: %v", err)
		}
	}
}
