"""通过 GitHub Git Data API 把 dist/ 发布到 gh-pages 分支（绕过被墙的 github.com:443）
用法：GHTOKEN=ghp_xxx python scripts/deploy_gh.py dist gh-pages "提交说明"
"""
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

SESSION = requests.Session()
SESSION.trust_env = False  # 绕过系统代理，直连 api.github.com


def call(method: str, url: str, **kw):
    for i in range(5):
        try:
            r = SESSION.request(method, url, headers=H, timeout=60, **kw)
            r.raise_for_status()
            return r.json()
        except Exception:
            if i == 4:
                raise
            time.sleep(2 * (i + 1))
    return None


dist = Path(sys.argv[1])  # dist 目录
branch = sys.argv[2]      # 目标分支
message = sys.argv[3]     # commit message

files = [p for p in dist.rglob('*') if p.is_file()]
print(f'上传 {len(files)} 个文件到 {branch} ...')

# 1. blobs
tree_items = []
for p in files:
    rel = p.relative_to(dist).as_posix()
    content = base64.b64encode(p.read_bytes()).decode()
    blob = call('POST', f'{API}/git/blobs', json={'content': content, 'encoding': 'base64'})
    tree_items.append({'path': rel, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
    print('  blob:', rel)

# 2. tree
tree = call('POST', f'{API}/git/trees', json={'tree': tree_items})

# 3. commit（挂在分支历史上，保留提交链）
try:
    ref = call('GET', f'{API}/git/refs/heads/{branch}')
    parents = [ref['object']['sha']]
except Exception:
    parents = []
commit = call('POST', f'{API}/git/commits', json={
    'message': message,
    'tree': tree['sha'],
    'parents': parents,
    'author': {'name': 'linmeitian', 'email': 'linmeitian2024@gmail.com'},
})

# 4. 创建或更新分支引用
r = SESSION.post(f'{API}/git/refs', headers=H, json={'ref': f'refs/heads/{branch}', 'sha': commit['sha']}, timeout=60)
if r.status_code == 422:  # 已存在则更新
    r = SESSION.patch(f'{API}/git/refs/heads/{branch}', headers=H, json={'sha': commit['sha'], 'force': True}, timeout=60)
r.raise_for_status()
print(f'{branch} -> {commit["sha"][:8]} ✅')
