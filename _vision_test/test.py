# -*- coding: utf-8 -*-
"""
MiMo-VL grounding 验证脚本（零依赖，仅用 Python 标准库）。
流程: manga.png -> base64 -> OpenAI兼容多模态接口 -> 返回每块文字 {bbox,日文,中文}
     -> 生成 result.html，把框+译文叠在原图上，浏览器打开看准不准。

用法:
  设置三个环境变量后运行 python test.py
    AT_BASE_URL   例如 https://xxx/v1           (不要带 /chat/completions)
    AT_API_KEY    你的 key
    AT_MODEL      模型名，例如 mimo-vl-2.5 / MiMo-VL-7B 之类
"""
import os, sys, json, base64, urllib.request, urllib.error

BASE_URL = os.environ.get("AT_BASE_URL", "").rstrip("/")
API_KEY  = os.environ.get("AT_API_KEY", "")
MODEL    = os.environ.get("AT_MODEL", "")
IMG_PATH = os.path.join(os.path.dirname(__file__), "manga.png")

if not (BASE_URL and API_KEY and MODEL):
    print("缺少环境变量。需要 AT_BASE_URL / AT_API_KEY / AT_MODEL")
    sys.exit(1)

# ---- 读图 + 尺寸 ----
with open(IMG_PATH, "rb") as f:
    raw = f.read()
b64 = base64.b64encode(raw).decode()

# 从 PNG 头读宽高（IHDR 在固定偏移）
W = int.from_bytes(raw[16:20], "big")
H = int.from_bytes(raw[20:24], "big")
print(f"图片尺寸: {W} x {H}")

# ---- 提示词：要求归一化坐标 + 漫画阅读顺序 ----
PROMPT = f"""你是漫画翻译助手。这张图是日文漫画的一页，尺寸为宽 {W} 像素、高 {H} 像素。
请找出图中所有的对话气泡、旁白框、画面内文字（拟声词可选），对每一块：
1. 给出它的边界框坐标 bbox = [x1, y1, x2, y2]，使用**绝对像素坐标**（左上为原点，0<=x<={W}, 0<=y<={H}）。
2. 给出原文 jp（保留原始日文）。
3. 给出简体中文翻译 zh（自然流畅，符合漫画语气）。
按漫画阅读顺序（从右到左、从上到下）排列。
只输出 JSON，格式：
{{"blocks":[{{"bbox":[x1,y1,x2,y2],"jp":"...","zh":"..."}}]}}
不要输出任何额外说明或 markdown 代码块标记。"""

body = {
    "model": MODEL,
    "messages": [{
        "role": "user",
        "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
        ],
    }],
    "temperature": 0,
    "stream": False,
}

url = f"{BASE_URL}/chat/completions"
print(f"请求: {url}  model={MODEL}")
req = urllib.request.Request(
    url,
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode())
except urllib.error.HTTPError as e:
    print("HTTP错误", e.code)
    print(e.read().decode(errors="replace")[:2000])
    sys.exit(1)

content = data["choices"][0]["message"]["content"].strip()
# 去掉可能的 ```json 包裹
if content.startswith("```"):
    content = content.split("```", 2)[1]
    if content.startswith("json"):
        content = content[4:]
    content = content.strip().rstrip("`").strip()

print("\n===== 模型原始返回 =====")
print(content[:3000])

try:
    parsed = json.loads(content)
    blocks = parsed.get("blocks", parsed if isinstance(parsed, list) else [])
except Exception as e:
    print("\nJSON解析失败:", e)
    sys.exit(1)

print(f"\n共 {len(blocks)} 块")

# ---- 坐标系自检：若所有坐标都 <=1000，疑似归一化(0~1000)，自动换算回像素 ----
all_coords = [c for b in blocks for c in b.get("bbox", [])]
if all_coords and max(all_coords) <= 1000 and max(W, H) > 1000:
    print("⚠ 检测到坐标可能是 0~1000 归一化，自动换算回像素。")
    for b in blocks:
        x1, y1, x2, y2 = b["bbox"]
        b["bbox"] = [x1 / 1000 * W, y1 / 1000 * H, x2 / 1000 * W, y2 / 1000 * H]

# ---- 生成叠层 HTML（坐标按百分比定位，自适应缩放）----
img_b64_uri = f"data:image/png;base64,{b64}"
boxes_html = []
for i, b in enumerate(blocks):
    x1, y1, x2, y2 = b["bbox"]
    left = x1 / W * 100
    top = y1 / H * 100
    bw = (x2 - x1) / W * 100
    bh = (y2 - y1) / H * 100
    zh = (b.get("zh", "")).replace("<", "&lt;").replace(">", "&gt;")
    jp = (b.get("jp", "")).replace("<", "&lt;").replace(">", "&gt;")
    boxes_html.append(f"""
    <div class="box" style="left:{left:.2f}%;top:{top:.2f}%;width:{bw:.2f}%;height:{bh:.2f}%">
      <span class="idx">{i+1}</span>
      <div class="tip">[{i+1}] {jp}<br><b>{zh}</b></div>
    </div>""")

html = f"""<!doctype html><html><head><meta charset="utf-8">
<style>
  body{{margin:0;background:#222;font-family:sans-serif}}
  .wrap{{position:relative;display:inline-block}}
  .wrap img{{display:block;max-width:100vw}}
  .box{{position:absolute;border:2px solid red;box-sizing:border-box}}
  .idx{{position:absolute;top:-2px;left:-2px;background:red;color:#fff;font-size:12px;padding:0 3px}}
  .tip{{position:absolute;left:0;top:100%;background:rgba(0,0,0,.85);color:#fff;
        font-size:13px;padding:4px 6px;width:max-content;max-width:240px;
        z-index:10;display:none;white-space:normal}}
  .box:hover .tip{{display:block}}
  .box:hover{{border-color:#0f0;background:rgba(0,255,0,.12)}}
  #list{{color:#ddd;padding:10px;font-size:13px;line-height:1.7}}
</style></head><body>
<div class="wrap"><img src="{img_b64_uri}">{''.join(boxes_html)}</div>
<div id="list"><h3 style="color:#fff">译文列表（鼠标悬停红框看对应）</h3>
{''.join(f'<div>[{i+1}] {b.get("jp","")} → <b style="color:#9f9">{b.get("zh","")}</b></div>' for i,b in enumerate(blocks))}
</div>
</body></html>"""

out = os.path.join(os.path.dirname(__file__), "result.html")
with open(out, "w", encoding="utf-8") as f:
    f.write(html)
print(f"\n已生成: {out}\n用浏览器打开它，鼠标悬停红框看译文是否贴对位置。")
