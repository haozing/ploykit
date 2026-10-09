package contractx

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

func HashJSON(value any) (string, error) {
	document, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("contractx: marshal value for hashing: %w", err)
	}
	return hashBytes(document), nil
}

func hashBytes(document []byte) string {
	digest := sha256.Sum256(document)
	return hex.EncodeToString(digest[:])
}

func isSHA256Hex(value string) bool {
	if len(value) != sha256.Size*2 || strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
