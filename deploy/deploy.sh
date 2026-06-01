#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "==============================================================="
echo "🇮🇳 APEX AGENTIC STOCK ANALYZER - UBUNTU INSTALLER"
echo "==============================================================="

# Ensure script is not run as root directly, but has sudo capabilities
if [ "$EUID" -eq 0 ]; then
  echo "❌ Please do not run this script as root directly. Run it as: ./deploy.sh"
  exit 1
fi

# Ask for configuration values interactively
read -p "Enter your DuckDNS Subdomain (e.g., my-stock-advisor): " SUBDOMAIN
read -p "Enter your DuckDNS Token: " DUCK_TOKEN
read -p "Enter your GROQ API Key: " GROQ_KEY

if [ -z "$SUBDOMAIN" ] || [ -z "$DUCK_TOKEN" ] || [ -z "$GROQ_KEY" ]; then
    echo "❌ All inputs are required. Restarting script..."
    exit 1
fi

echo "🚀 Starting installation..."

# 1. Update OS package lists
echo "🔄 Updating system repositories..."
sudo apt update -y

# 2. Install required system packages
echo "📦 Installing Python, Git, Nginx, Certbot, and utilities..."
sudo apt install -y python3-pip python3-venv git curl nginx certbot python3-certbot-nginx sqlite3

# 3. Prepare Workspace Directory
cd /home/ubuntu/indian-stock-analyzer

# 4. Setup Python Virtual Environment & dependencies
echo "🐍 Initializing Python Virtual Environment..."
python3 -m venv venv
source venv/bin/activate

echo "⚡ Installing Python requirements..."
pip install --upgrade pip
pip install -r backend/requirements.txt

# 5. Write Environment Configurations (.env)
echo "🔒 Writing application environment credentials..."
cat <<EOF > .env
GROQ_API_KEY=${GROQ_KEY}
PORT=8000
DATABASE_DIR=/home/ubuntu/indian-stock-analyzer/backend/data
EOF
chmod 600 .env

# Create data directory if not exists
mkdir -p backend/data

# 6. Configure Systemd Service Uptime
echo "⚙️ Registering Systemd daemon service..."
sudo cp deploy/stock_analyzer.service /etc/systemd/system/stock_analyzer.service
sudo systemctl daemon-reload
sudo systemctl enable stock_analyzer.service
sudo systemctl start stock_analyzer.service

# 7. Configure Nginx Web Server Reverse-Proxy
echo "🌐 Configuring Nginx reverse-proxy router..."
# Replace placeholder subdomain in the configuration template
sed "s/YOUR_SUBDOMAIN/${SUBDOMAIN}/g" deploy/nginx.conf > temp_nginx.conf
sudo mv temp_nginx.conf /etc/nginx/sites-available/stock_analyzer
sudo ln -sf /etc/nginx/sites-available/stock_analyzer /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# 8. Crucial Oracle Firewall Port Ingress Overrides (VERY IMPORTANT!)
echo "🛡️ Configuring Ubuntu iptables firewall (Opening ports 80 & 443)..."
# Oracle Cloud default Linux images block all ports by default even if console ingress rules are open
sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save || true

# 9. Setup DuckDNS Client Automation
echo "🦆 Configuring DuckDNS dynamic IP updates..."
chmod +x deploy/setup_duckdns.sh
./deploy/setup_duckdns.sh "${SUBDOMAIN}" "${DUCK_TOKEN}"

echo "==============================================================="
echo "✅ DEPLOYMENT SYSTEM READY!"
echo "==============================================================="
echo "1. Your local FastAPI backend is running via Systemd service."
echo "2. Your Nginx reverse proxy is linked to port 80."
echo "3. Your DNS is mapped at: http://${SUBDOMAIN}.duckdns.org"
echo ""
echo "🚀 NEXT STEP (SSL / HTTPS Integration):"
echo "To secure your website and enable HTTPS 🔒, copy and run this command:"
echo "👉 sudo certbot --nginx -d ${SUBDOMAIN}.duckdns.org"
echo "==============================================================="
