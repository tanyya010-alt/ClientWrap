#!/usr/bin/env bash
# Daily logical backup. Uses DATABASE_URL (or BACKUP_DATABASE_URL). Optionally uploads to S3-compatible storage
# when BACKUP_S3_URI is set (requires the aws CLI), and encrypts with BACKUP_GPG_RECIPIENT if set.
# Keeps the last $BACKUP_KEEP_DAYS days locally (default 14).
set -euo pipefail
URL="${BACKUP_DATABASE_URL:-${DATABASE_URL:?DATABASE_URL is required}}"
DIR="${BACKUP_DIR:-./backups}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DIR/clientwrap-$STAMP.dump"
pg_dump --format=custom --no-owner --no-privileges "$URL" > "$FILE"
if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
  gpg --batch --yes --trust-model always --encrypt --recipient "$BACKUP_GPG_RECIPIENT" "$FILE"
  rm "$FILE"
  FILE="$FILE.gpg"
fi
echo "backup written: $FILE ($(du -h "$FILE" | cut -f1))"
if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  aws s3 cp "$FILE" "$BACKUP_S3_URI/$(basename "$FILE")"
  echo "uploaded to $BACKUP_S3_URI"
fi
find "$DIR" -name 'clientwrap-*.dump*' -mtime +"$KEEP" -delete
# Restore: pg_restore --clean --no-owner -d "$TARGET_DATABASE_URL" clientwrap-<stamp>.dump
