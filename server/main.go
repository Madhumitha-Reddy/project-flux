package main

import (
	"log"
	"net"
	"net/http"

	"github.com/flux-pkm/server/internal/api"
	application "github.com/flux-pkm/server/internal/app"
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
	defer func() {
		if err := vaultManager.Close(); err != nil {
			log.Printf("Failed to close vault: %v", err)
		}
	}()
	appService := application.NewService(vaultManager)

	// Set Gin mode
	if cfg.Environment == "production" || cfg.Environment == "desktop" {
		gin.SetMode(gin.ReleaseMode)
	}

	// Create router
	router := gin.Default()

	// Setup CORS for the browser shell. Electron uses its preload bridge.
	router.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", cfg.AllowedOrigin)
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, PATCH, DELETE")
		c.Writer.Header().Set("Vary", "Origin")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	// Register API routes
	api.RegisterRoutes(router, appService)

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, appService.Status())
	})

	// Start server
	address := cfg.Host + ":" + cfg.Port
	log.Printf("Starting FLUX server on %s", address)
	if err := router.Run(address); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
