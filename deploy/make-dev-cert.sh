#!/bin/sh
# Tạo chứng chỉ tự ký cho bản HTTPS trên máy phát triển (`docker-compose.https.yml`), hạn 365 ngày, dùng được cho
# `localhost` và `127.0.0.1`. Trình duyệt sẽ cảnh báo vì không ai ký chứng chỉ này; trên server thật, đặt chứng chỉ
# do một nơi cấp chứng chỉ ký (Let's Encrypt chẳng hạn) vào cùng hai đường dẫn, không dùng script này.
#
# Chạy từ thư mục gốc của repo, trong Git Bash hoặc shell của Linux/macOS: sh deploy/make-dev-cert.sh
set -eu

dir="$(dirname "$0")/certs"
mkdir -p "$dir"
if [ -e "$dir/vietstrain.crt" ] || [ -e "$dir/vietstrain.key" ]; then
    echo "Đã có chứng chỉ trong $dir; xoá hai file vietstrain.crt và vietstrain.key nếu muốn tạo lại." >&2
    exit 1
fi

# Git Bash đổi mọi đối số bắt đầu bằng "/" thành đường dẫn Windows, kể cả "/CN=localhost"; biến này tắt việc đó.
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    -keyout "$dir/vietstrain.key" -out "$dir/vietstrain.crt"
echo "Đã tạo $dir/vietstrain.crt và $dir/vietstrain.key"
