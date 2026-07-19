package api

import (
	"errors"
	"net/http"
	"os"
	"strconv"

	application "github.com/flux-pkm/server/internal/app"
	"github.com/flux-pkm/server/internal/domain"
	"github.com/flux-pkm/server/internal/files"
	"github.com/flux-pkm/server/internal/vault"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	app *application.Service
}

const maxRequestBodyBytes = 50 << 20

func RegisterRoutes(router *gin.Engine, app *application.Service) {
	handler := &Handler{app: app}
	v1 := router.Group("/api/v1")
	v1.Use(limitRequestBody)
	v1.GET("/status", handler.status)
	v1.POST("/vaults/open", handler.openVault)
	v1.POST("/vaults/create", handler.createVault)
	v1.GET("/vaults/:vaultId/revision", handler.vaultRevision)
	v1.GET("/vaults/:vaultId/events", handler.vaultEvents)
	v1.GET("/vaults/:vaultId/files", handler.listFiles)
	v1.POST("/vaults/:vaultId/directories", handler.createDirectory)
	v1.POST("/vaults/:vaultId/files", handler.createFile)
	v1.DELETE("/vaults/:vaultId/files", handler.deleteFile)
	v1.GET("/vaults/:vaultId/files/content", handler.readFile)
	v1.GET("/vaults/:vaultId/files/raw", handler.readRawFile)
	v1.PUT("/vaults/:vaultId/files/content", handler.saveFile)
	v1.PATCH("/vaults/:vaultId/files/content", handler.patchFile)
	v1.POST("/vaults/:vaultId/files/move", handler.moveFile)
	v1.POST("/vaults/:vaultId/files/restore", handler.restoreFile)
	v1.GET("/vaults/:vaultId/trash", handler.listTrash)
	v1.DELETE("/vaults/:vaultId/trash", handler.purgeTrash)
	v1.DELETE("/vaults/:vaultId/trash/:trashId", handler.permanentlyDelete)
}

type pathRequest struct {
	Path string `json:"path" binding:"required"`
}

func (h *Handler) createDirectory(c *gin.Context) {
	var request pathRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	entry, err := h.app.CreateDirectory(c.Param("vaultId"), request.Path)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, entry)
}

type createFileRequest struct {
	Path    string `json:"path" binding:"required"`
	Content string `json:"content"`
}

func (h *Handler) createFile(c *gin.Context) {
	var request createFileRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	document, err := h.app.CreateFile(c.Param("vaultId"), request.Path, request.Content)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, document)
}

func (h *Handler) status(c *gin.Context) {
	c.JSON(http.StatusOK, h.app.Status())
}

type openVaultRequest struct {
	Path string `json:"path"`
}

func (h *Handler) openVault(c *gin.Context) {
	var request openVaultRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	info, err := h.app.OpenVault(request.Path)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, info)
}

func (h *Handler) createVault(c *gin.Context) {
	var request pathRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	info, err := h.app.CreateVault(request.Path)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, info)
}

func (h *Handler) listFiles(c *gin.Context) {
	entries, err := h.app.ListFiles(c.Param("vaultId"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, entries)
}

func (h *Handler) vaultRevision(c *gin.Context) {
	revision, err := h.app.VaultRevision(c.Param("vaultId"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"revision": revision})
}

func (h *Handler) vaultEvents(c *gin.Context) {
	vaultID := c.Param("vaultId")
	revision, err := h.app.VaultRevision(vaultID)
	if err != nil {
		writeError(c, err)
		return
	}
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "stream_unsupported", "error": "streaming is unavailable"})
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	c.SSEvent("revision", gin.H{"revision": revision})
	flusher.Flush()
	for c.Request.Context().Err() == nil {
		next, waitErr := h.app.WaitVaultRevision(c.Request.Context(), vaultID, revision)
		if waitErr != nil || c.Request.Context().Err() != nil {
			return
		}
		if next == revision {
			continue
		}
		revision = next
		c.SSEvent("revision", gin.H{"revision": revision})
		flusher.Flush()
	}
}

func (h *Handler) readFile(c *gin.Context) {
	document, err := h.app.ReadFile(c.Param("vaultId"), c.Query("path"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, document)
}

func (h *Handler) readRawFile(c *gin.Context) {
	document, err := h.app.ReadFile(c.Param("vaultId"), c.Query("path"))
	if err != nil {
		writeError(c, err)
		return
	}
	content := []byte(document.Content)
	c.Data(http.StatusOK, http.DetectContentType(content), content)
}

type saveFileRequest struct {
	Path         string `json:"path" binding:"required"`
	Content      string `json:"content"`
	ExpectedHash string `json:"expectedHash"`
}

func (h *Handler) saveFile(c *gin.Context) {
	var request saveFileRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	result, err := h.app.SaveFile(
		c.Param("vaultId"),
		request.Path,
		request.Content,
		request.ExpectedHash,
	)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

type patchFileRequest struct {
	Path         string            `json:"path" binding:"required"`
	ExpectedHash string            `json:"expectedHash" binding:"required"`
	Edits        []domain.TextEdit `json:"edits" binding:"required,min=1"`
}

func (h *Handler) patchFile(c *gin.Context) {
	var request patchFileRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	result, err := h.app.PatchFile(c.Param("vaultId"), request.Path, request.ExpectedHash, request.Edits)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

type moveFileRequest struct {
	SourcePath      string `json:"sourcePath" binding:"required"`
	DestinationPath string `json:"destinationPath" binding:"required"`
}

func (h *Handler) moveFile(c *gin.Context) {
	var request moveFileRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	entry, err := h.app.MoveFile(c.Param("vaultId"), request.SourcePath, request.DestinationPath)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, entry)
}

func (h *Handler) deleteFile(c *gin.Context) {
	entry, err := h.app.DeleteFile(c.Param("vaultId"), c.Query("path"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, entry)
}

type restoreFileRequest struct {
	TrashID string `json:"trashId" binding:"required"`
}

func (h *Handler) restoreFile(c *gin.Context) {
	var request restoreFileRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	entry, err := h.app.RestoreFile(c.Param("vaultId"), request.TrashID)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, entry)
}

func (h *Handler) listTrash(c *gin.Context) {
	entries, err := h.app.ListTrash(c.Param("vaultId"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, entries)
}

func (h *Handler) permanentlyDelete(c *gin.Context) {
	if c.Query("confirm") != "true" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "confirmation_required", "error": "permanent deletion requires confirm=true"})
		return
	}
	if err := h.app.PermanentlyDelete(c.Param("vaultId"), c.Param("trashId")); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) purgeTrash(c *gin.Context) {
	if c.Query("confirm") != "true" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "confirmation_required", "error": "trash purge requires confirm=true"})
		return
	}
	days, err := strconv.Atoi(c.Query("olderThanDays"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_retention", "error": "olderThanDays must be 7, 30, or 90"})
		return
	}
	result, err := h.app.PurgeTrash(c.Param("vaultId"), days)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func writeError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, vault.ErrNotConfigured):
		c.JSON(http.StatusConflict, gin.H{"code": "vault_not_configured", "error": err.Error()})
	case errors.Is(err, vault.ErrPathRequired):
		c.JSON(http.StatusBadRequest, gin.H{"code": "vault_path_required", "error": err.Error()})
	case errors.Is(err, vault.ErrNotOpen):
		c.JSON(http.StatusNotFound, gin.H{"code": "vault_not_open", "error": err.Error()})
	case errors.Is(err, vault.ErrVaultMismatch), errors.Is(err, vault.ErrNestedVault), errors.Is(err, files.ErrInvalidPath):
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_path", "error": err.Error()})
	case errors.Is(err, files.ErrConflict):
		c.JSON(http.StatusConflict, gin.H{"code": "file_conflict", "error": err.Error()})
	case errors.Is(err, files.ErrInvalidEdit):
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_edit", "error": err.Error()})
	case errors.Is(err, files.ErrRetention):
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_retention", "error": err.Error()})
	default:
		if errors.Is(err, os.ErrExist) {
			c.JSON(http.StatusConflict, gin.H{"code": "path_exists", "error": "destination already exists"})
			return
		}
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusNotFound, gin.H{"code": "file_not_found", "error": "file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "internal_error", "error": "internal server error"})
	}
}

func limitRequestBody(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxRequestBodyBytes)
	c.Next()
}

func writeRequestError(c *gin.Context, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": "request_too_large", "error": "request body exceeds 50 MiB"})
		return
	}
	c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_request", "error": "invalid request body"})
}
