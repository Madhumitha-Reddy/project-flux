package config

import "os"

type Config struct {
	Environment   string
	Host          string
	VaultPath     string
	AllowedOrigin string
	Port          string
}

func Load() *Config {
	environment := getEnv("ENVIRONMENT", "development")
	return &Config{
		Environment:   environment,
		Host:          getEnv("HOST", defaultHost(environment)),
		VaultPath:     os.Getenv("FLUX_VAULT_PATH"),
		AllowedOrigin: getEnv("CORS_ALLOWED_ORIGIN", "http://localhost:3000"),
		Port:          getEnv("PORT", "8080"),
	}
}

func defaultHost(environment string) string {
	if environment == "production" {
		return "0.0.0.0"
	}
	return "127.0.0.1"
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
