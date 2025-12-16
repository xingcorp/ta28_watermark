#!/bin/bash

# Ubuntu Production Performance Setup Script
# Tối ưu hóa hệ thống Ubuntu cho Node.js high-performance

echo "🚀 Setting up Ubuntu for high-performance Node.js production..."

# 1. System limits optimization
echo "📊 Configuring system limits..."
cat >> /etc/security/limits.conf << EOF
# Node.js performance limits
* soft nofile 65536
* hard nofile 65536
* soft nproc 32768
* hard nproc 32768
root soft nofile 65536
root hard nofile 65536
root soft nproc 32768
root hard nproc 32768
EOF

# 2. Kernel parameters optimization
echo "⚙️ Optimizing kernel parameters..."
cat >> /etc/sysctl.conf << EOF
# Network performance
net.core.somaxconn = 65536
net.core.netdev_max_backlog = 5000
net.ipv4.tcp_max_syn_backlog = 65536
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_intvl = 60
net.ipv4.tcp_keepalive_probes = 10

# Memory management
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
vm.overcommit_memory = 1

# File system
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
EOF

# Apply sysctl changes
sysctl -p

# 3. CPU Governor optimization
echo "💻 Setting CPU governor to performance..."
echo 'performance' | tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor

# Make CPU governor persistent
cat > /etc/systemd/system/cpu-performance.service << EOF
[Unit]
Description=Set CPU governor to performance mode
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'echo performance | tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl enable cpu-performance.service

# 4. Install performance monitoring tools
echo "📈 Installing performance monitoring tools..."
apt update
apt install -y htop iotop nethogs sysstat

# 5. FFmpeg optimization
echo "🎥 Installing optimized FFmpeg..."
apt install -y software-properties-common
add-apt-repository ppa:jonathonf/ffmpeg-4 -y
apt update
apt install -y ffmpeg

# 6. Node.js memory optimization
echo "🧠 Creating Node.js optimization script..."
cat > /usr/local/bin/node-optimize << 'EOF'
#!/bin/bash
# Node.js production optimization wrapper

export NODE_OPTIONS="--max-old-space-size=8192 --optimize-for-size --gc-interval=100"
export UV_THREADPOOL_SIZE=128
export MALLOC_ARENA_MAX=2

exec "$@"
EOF

chmod +x /usr/local/bin/node-optimize

# 7. PM2 optimization
echo "⚡ Installing and configuring PM2..."
npm install -g pm2@latest

# PM2 startup script
pm2 startup

# 8. Create performance monitoring script
cat > /usr/local/bin/performance-monitor << 'EOF'
#!/bin/bash
echo "=== System Performance Monitor ==="
echo "CPU Usage:"
top -bn1 | grep "Cpu(s)" | awk '{print $2 + $4"%"}'

echo -e "\nMemory Usage:"
free -h | awk 'NR==2{printf "Memory Usage: %s/%s (%.2f%%)\n", $3,$2,$3*100/$2 }'

echo -e "\nDisk Usage:"
df -h | awk '$NF=="/"{printf "Disk Usage: %d/%dGB (%s)\n", $3,$2,$5}'

echo -e "\nNetwork Connections:"
ss -tuln | wc -l

echo -e "\nPM2 Status:"
pm2 status

echo -e "\nFFmpeg Processes:"
ps aux | grep ffmpeg | grep -v grep | wc -l
EOF

chmod +x /usr/local/bin/performance-monitor

# 9. Automatic cleanup script
cat > /usr/local/bin/cleanup-temp << 'EOF'
#!/bin/bash
# Clean up temporary files older than 2 hours
find /tmp -name "*.tmp" -mtime +0.08 -delete 2>/dev/null
find /tmp -name "ffmpeg*" -mtime +0.08 -delete 2>/dev/null
find /var/tmp -name "*.tmp" -mtime +0.08 -delete 2>/dev/null

# Clean up processed files older than 24 hours if disk usage > 80%
DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ $DISK_USAGE -gt 80 ]; then
    find /path/to/processed -name "*.mp4" -mtime +1 -delete 2>/dev/null
    find /path/to/processed -name "*.jpg" -mtime +1 -delete 2>/dev/null
fi
EOF

chmod +x /usr/local/bin/cleanup-temp

# Add to crontab
(crontab -l 2>/dev/null; echo "*/30 * * * * /usr/local/bin/cleanup-temp") | crontab -

echo "✅ Ubuntu performance optimization completed!"
echo ""
echo "🔧 Next steps:"
echo "1. Reboot the server: sudo reboot"
echo "2. Deploy your app with: pm2 start ecosystem.config.js"
echo "3. Monitor performance: performance-monitor"
echo "4. Check PM2 status: pm2 monit"
echo ""
echo "⚡ Performance features enabled:"
echo "- CPU governor set to performance mode"
echo "- Increased file descriptors and process limits"
echo "- Optimized kernel parameters for networking"
echo "- FFmpeg with hardware acceleration support"
echo "- Node.js memory optimization"
echo "- Automatic cleanup of temporary files"
