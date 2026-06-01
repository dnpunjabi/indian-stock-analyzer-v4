#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "========================================="
echo "🦆 DUCKDNS IP SYNC SETUP"
echo "========================================="

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: ./setup_duckdns.sh <your-subdomain> <your-duckdns-token>"
    echo "Example: ./setup_duckdns.sh stock-analyzer abcdef12-3456-7890-abcd-ef1234567890"
    exit 1
fi

SUBDOMAIN=$1
TOKEN=$2

echo "Configuring DuckDNS for: $SUBDOMAIN.duckdns.org"

# Create duck folder
mkdir -p ~/duck
cd ~/duck

# Write the dynamic update script
cat <<EOF > duck.sh
#!/usr/bin/env bash
echo url="https://www.duckdns.org/update?domains=${SUBDOMAIN}&token=${TOKEN}&ip=" | curl -k -o ~/duck/duck.log -K -
EOF

chmod +x duck.sh

# Initialize the first run
echo "Running initial IP sync..."
./duck.sh
echo "Status check (see log below):"
cat duck.log
echo ""

# Setup cron job (run every 5 minutes)
CRON_JOB="*/5 * * * * ~/duck/duck.sh >/dev/null 2>&1"
(crontab -l 2>/dev/null | grep -Fv "~/duck/duck.sh"; echo "$CRON_JOB") | crontab -

echo "✅ DuckDNS set up successfully! Cron job scheduled for every 5 minutes."
echo "Your server domain: http://$SUBDOMAIN.duckdns.org"
echo "========================================="
