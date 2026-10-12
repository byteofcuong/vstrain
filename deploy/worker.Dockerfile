# Worker chạy trong image của Nextstrain để dùng đúng phiên bản công cụ đã đo:
# Augur 34.1.4, Nextclade 3.24.0, IQ-TREE 3.0.1, TreeTime 0.12.1.
FROM nextstrain/base:build-20260930T105229Z

# Thư viện của backend nằm trong một venv riêng, để không đụng tới các gói Python mà Augur phụ thuộc.
RUN python3 -m venv /opt/vietstrain
COPY requirements.txt requirements-dev.txt /tmp/
RUN /opt/vietstrain/bin/pip install --no-cache-dir -r /tmp/requirements.txt -r /tmp/requirements-dev.txt

# Thư mục làm việc của job thuộc về user thường; volume gắn vào đây thừa hưởng quyền này.
RUN mkdir -p /work && chown nextstrain:nextstrain /work

WORKDIR /srv/backend
COPY . .
ENV PATH=/opt/vietstrain/bin:$PATH PYTHONPATH=/srv/backend PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

# Bỏ entrypoint của Nextstrain (nó dành cho lệnh `nextstrain build`) và không chạy bằng root.
USER nextstrain
ENTRYPOINT []
CMD ["python", "-m", "app.jobs.worker"]
