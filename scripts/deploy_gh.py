"""通过 GitHub Git Data API 把 dist/ 发布到 gh-pages 分支（绕过被墙的 github.com:443）"""
import base64
import os
import sys
import time
from pathlib import Path

import requests

TOKEN = os.environ['GHTOKEN']
REPO = 'startorchlmt/guandan-coach'
API = f'https://api.github.com/repos/{REPO}'
H = {'Authorization': f'token {TOKEN}', 'Accept': 'application/vnd.github+json'}

dist = Path(sys.argv[1])  # dist 目录
branch = sys.argv[2]      # 目标分支
message = sys.argv[3]     # commit message
prefix = sys.argv[4] if len(sys.argv) > 4 else ''  # 树内前缀（gh-pages 用 ''，源码用 ''）

files = [p for p in dist.rglob('*') if p.is_file()]
print(f'上传 {len(files)} 个文件到 {branch} ...')

# 1. blobs
tree_items = []
for p in files:
    rel = p.relative_to(dist).as_posix()
    content = base64.b64encode(p.read_bytes()).decode()
    r = requests.post(f'{API}/git/blobs', headers=H, json={'content': content, 'encoding': 'base64'})
    r.raise_for_status()
    tree_items.append({'path': prefix + rel, 'mode': '100644', 'type': 'blob', 'sha': r.json()['sha']})
    print('  blob:', rel)

# 2. tree
r = requests.post(f'{API}/git/trees', headers=H, json={'tree': tree_items})
r.raise_for_status()
tree_sha = r.json()['sha']

# 3. commit
r = requests.post(f'{API}/git/commits', headers=H, json={
    'message': message,
    'tree': tree_sha,
    'author': {'name': 'linmeitian', 'email': 'linmeitian2024@gmail.com'},
})
r.raise_for_status()
commit_sha = r.json()['sha']

# 4. 创建或更新分支引用
r = requests.post(f'{API}/git/refs', headers=H, json={'ref': f'refs/heads/{branch}', 'sha': commit_sha})
if r.status_code == 422:  # 已存在则更新
    r = requests.patch(f'{API}/git/refs/heads/{branch}', headers=H, json={'sha': commit_sha, 'force': True})
r.raise_for_status()
print(f'{branch} -> {commit_sha[:8]} ✅')
