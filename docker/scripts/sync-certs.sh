#!/bin/bash
#
# sync-certs.sh - Sync SSL certificates from Traefik to LiveKit server
#
# This script extracts SSL certificates from Traefik's acme.json using 
# traefik-certs-dumper Docker image and syncs them to a LiveKit server.
# It should be run from the Traefik machine.
#
# Prerequisites:
#   - Docker must be installed and running on the Traefik machine
#   - SSH access to the LiveKit machine
#   - Traefik acme.json file must exist
#
# Usage:
#   ./sync-certs.sh [options] [traefik_acme_json] [livekit_host] [livekit_certs_path] [ssh_key]
#
# Options:
#   -d, --domain DOMAIN    Sync only certificates for specific domain
#   -v, --traefik-version  Traefik version (v2 or v3, default: v2)
#   -h, --help            Show this help message
#
# Examples:
#   # Sync all certificates (Traefik v2)
#   ./sync-certs.sh /opt/traefik/acme.json livekit.example.com /opt/orbital/livekit/certs ~/.ssh/id_rsa
#
#   # Sync specific domain only (Traefik v3)
#   ./sync-certs.sh --domain turn.example.com --traefik-version v3 /opt/traefik/acme.json livekit.example.com /opt/orbital/livekit/certs
#
# Cron job example (sync specific domain every hour):
#   0 * * * * /opt/traefik/sync-certs.sh -d turn.example.com -v v3 /opt/traefik/acme.json livekit.example.com /opt/orbital/livekit/certs >> /var/log/cert-sync.log 2>&1
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Show help
show_help() {
    sed -n '/^# Usage:/,/^# Cron job example/p' "$0" | sed 's/^# //'
}

# Parse command line arguments
parse_args() {
    DOMAIN=""
    TRAEFIK_VERSION="v2"
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            -d|--domain)
                DOMAIN="$2"
                shift 2
                ;;
            -v|--traefik-version)
                TRAEFIK_VERSION="$2"
                shift 2
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            -*)
                log "${RED}Unknown option: $1${NC}"
                show_help
                exit 1
                ;;
            *)
                break
                ;;
        esac
    done
    
    # Positional arguments
    TRAEFIK_ACME_JSON="${1:-${TRAEFIK_ACME_JSON:-/opt/traefik/acme.json}}"
    LIVEKIT_HOST="${2:-${LIVEKIT_HOST:-livekit.example.com}}"
    LIVEKIT_CERTS_PATH="${3:-${LIVEKIT_CERTS_PATH:-/opt/orbital/livekit/certs}}"
    SSH_KEY="${4:-${SSH_KEY:-~/.ssh/id_rsa}}"
    SSH_USER="${SSH_USER:-root}"
    
    # traefik-certs-dumper Docker image
    CERTS_DUMPER_IMAGE="${CERTS_DUMPER_IMAGE:-ldez/traefik-certs-dumper:v2.11.0}"
}

# Check if required tools are available
check_dependencies() {
    if ! command -v docker &> /dev/null; then
        log "${RED}Error: docker is not installed${NC}"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        log "${RED}Error: docker daemon is not running${NC}"
        exit 1
    fi
    
    if ! command -v rsync &> /dev/null; then
        log "${RED}Error: rsync is not installed${NC}"
        exit 1
    fi
    
    if ! command -v ssh &> /dev/null; then
        log "${RED}Error: ssh is not installed${NC}"
        exit 1
    fi
}

# Validate paths and files
validate_paths() {
    if [ ! -f "$TRAEFIK_ACME_JSON" ]; then
        log "${RED}Error: Traefik acme.json not found: $TRAEFIK_ACME_JSON${NC}"
        exit 1
    fi
    
    if [ ! -f "$SSH_KEY" ]; then
        log "${YELLOW}Warning: SSH key not found at $SSH_KEY${NC}"
        log "Attempting to use default SSH authentication..."
        SSH_KEY=""
    fi
    
    # Validate Traefik version
    if [ "$TRAEFIK_VERSION" != "v2" ] && [ "$TRAEFIK_VERSION" != "v3" ]; then
        log "${RED}Error: Invalid Traefik version '$TRAEFIK_VERSION'. Must be 'v2' or 'v3'${NC}"
        exit 1
    fi
}

# Extract certificates from acme.json using traefik-certs-dumper
extract_certs() {
    local work_dir="/tmp/cert-sync-$$"
    mkdir -p "$work_dir"
    
    log "Extracting certificates from acme.json using traefik-certs-dumper..."
    log "Traefik version: $TRAEFIK_VERSION"
    
    if [ -n "$DOMAIN" ]; then
        log "Filtering for domain: $DOMAIN"
    fi
    
    # Build traefik-certs-dumper command
    local dumper_args="file --source /acme.json --dest /output"
    
    # Add version flag for Traefik v3
    if [ "$TRAEFIK_VERSION" = "v3" ]; then
        dumper_args="$dumper_args --version v3"
    fi
    
    # Run traefik-certs-dumper Docker container to extract certs
    if ! docker run --rm \
        -v "$TRAEFIK_ACME_JSON:/acme.json:ro" \
        -v "$work_dir:/output" \
        "$CERTS_DUMPER_IMAGE" \
        $dumper_args; then
        log "${RED}Error: Failed to extract certificates from acme.json${NC}"
        rm -rf "$work_dir"
        exit 1
    fi
    
    # Check if any certificates were extracted
    if [ -z "$(ls -A "$work_dir" 2>/dev/null)" ]; then
        log "${YELLOW}Warning: No certificates extracted from acme.json${NC}"
        rm -rf "$work_dir"
        exit 0
    fi
    
    log "${GREEN}Successfully extracted certificates to $work_dir${NC}"
    
    # Process extracted certificates
    local cert_count=0
    local target_dir="$work_dir"
    
    # If domain filter is specified, only process that domain
    if [ -n "$DOMAIN" ]; then
        if [ -d "$work_dir/$DOMAIN" ]; then
            target_dir="$work_dir/$DOMAIN"
            log "Processing domain: $DOMAIN"
        else
            log "${YELLOW}Warning: Domain '$DOMAIN' not found in acme.json${NC}"
            rm -rf "$work_dir"
            exit 0
        fi
    fi
    
    # Process certificates
    if [ -n "$DOMAIN" ]; then
        # Single domain mode - copy files directly to work_dir root
        if [ -f "$target_dir/cert.pem" ]; then
            cp "$target_dir/cert.pem" "$work_dir/cert.crt"
            log "Extracted certificate: cert.crt"
            cert_count=$((cert_count + 1))
        fi
        
        if [ -f "$target_dir/key.pem" ]; then
            cp "$target_dir/key.pem" "$work_dir/cert.key"
            log "Extracted key: cert.key"
        fi
        
        # Also copy with domain name for reference
        if [ -f "$target_dir/cert.pem" ]; then
            cp "$target_dir/cert.pem" "$work_dir/${DOMAIN}.crt"
        fi
        if [ -f "$target_dir/key.pem" ]; then
            cp "$target_dir/key.pem" "$work_dir/${DOMAIN}.key"
        fi
    else
        # All domains mode - process all domains
        for domain_dir in "$work_dir"/*; do
            if [ -d "$domain_dir" ]; then
                local domain=$(basename "$domain_dir")
                
                # Rename pem files to crt/key for LiveKit compatibility
                if [ -f "$domain_dir/cert.pem" ]; then
                    cp "$domain_dir/cert.pem" "$work_dir/${domain}.crt"
                    log "Extracted certificate for domain: $domain"
                    cert_count=$((cert_count + 1))
                fi
                
                if [ -f "$domain_dir/key.pem" ]; then
                    cp "$domain_dir/key.pem" "$work_dir/${domain}.key"
                fi
            fi
        done
    fi
    
    # Clean up domain subdirectories, keep only the cert files in root
    find "$work_dir" -mindepth 1 -type d -exec rm -rf {} + 2>/dev/null || true
    
    log "${GREEN}Extracted $cert_count certificate(s)${NC}"
    
    echo "$work_dir"
}

# Sync certificates to LiveKit server
sync_certs() {
    local source_dir="$1"
    
    log "${GREEN}Syncing certificates to $LIVEKIT_HOST...${NC}"
    
    # Build rsync command
    local rsync_opts="-avz --delete"
    if [ -n "$SSH_KEY" ]; then
        rsync_opts="$rsync_opts -e 'ssh -i $SSH_KEY -o StrictHostKeyChecking=no'"
    else
        rsync_opts="$rsync_opts -e 'ssh -o StrictHostKeyChecking=no'"
    fi
    
    # Ensure destination directory exists
    if [ -n "$SSH_KEY" ]; then
        ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${SSH_USER}@${LIVEKIT_HOST}" "mkdir -p $LIVEKIT_CERTS_PATH" 2>/dev/null || \
        ssh -o StrictHostKeyChecking=no "${SSH_USER}@${LIVEKIT_HOST}" "mkdir -p $LIVEKIT_CERTS_PATH"
    else
        ssh -o StrictHostKeyChecking=no "${SSH_USER}@${LIVEKIT_HOST}" "mkdir -p $LIVEKIT_CERTS_PATH"
    fi
    
    # Sync files
    if [ -n "$SSH_KEY" ]; then
        eval rsync $rsync_opts "${source_dir}/" "${SSH_USER}@${LIVEKIT_HOST}:${LIVEKIT_CERTS_PATH}/"
    else
        eval rsync $rsync_opts "${source_dir}/" "${SSH_USER}@${LIVEKIT_HOST}:${LIVEKIT_CERTS_PATH}/"
    fi
    
    if [ $? -eq 0 ]; then
        log "${GREEN}Certificates synced successfully!${NC}"
        
        # Restart LiveKit container to pick up new certificates
        log "Restarting LiveKit container..."
        local restart_result=0
        if [ -n "$SSH_KEY" ]; then
            ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${SSH_USER}@${LIVEKIT_HOST}" "cd /opt/orbital && docker compose restart livekit" 2>/dev/null || \
            restart_result=$?
        else
            ssh -o StrictHostKeyChecking=no "${SSH_USER}@${LIVEKIT_HOST}" "cd /opt/orbital && docker compose restart livekit" 2>/dev/null || \
            restart_result=$?
        fi
        
        if [ $restart_result -eq 0 ]; then
            log "${GREEN}LiveKit container restarted successfully${NC}"
        else
            log "${YELLOW}Warning: Failed to restart LiveKit container. You may need to restart it manually.${NC}"
        fi
    else
        log "${RED}Error: Failed to sync certificates${NC}"
        exit 1
    fi
}

# Cleanup temporary files
cleanup() {
    local work_dir="$1"
    if [ -n "$work_dir" ] && [ -d "$work_dir" ]; then
        rm -rf "$work_dir"
    fi
}

# Main execution
main() {
    parse_args "$@"
    
    log "Starting certificate sync..."
    
    check_dependencies
    validate_paths
    
    local work_dir
    work_dir=$(extract_certs)
    
    if [ ! -d "$work_dir" ] || [ -z "$(ls -A "$work_dir" 2>/dev/null)" ]; then
        log "${YELLOW}Warning: No certificates to sync${NC}"
        cleanup "$work_dir"
        exit 0
    fi
    
    sync_certs "$work_dir"
    cleanup "$work_dir"
    
    log "${GREEN}Certificate sync completed!${NC}"
}

# Run main function
main "$@"
