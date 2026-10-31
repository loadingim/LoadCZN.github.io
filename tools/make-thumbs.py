#!/usr/bin/env python3
"""파트너 목록용 작은 그림 만들기.

images/partners/full/<id>.webp(원본 전신) → images/partners/thumb/<id>.webp(가로 400px)
목록 카드는 PC에서 약 200px 폭이라 고해상도 화면(2배)까지 400px이면 충분하다.
상세 화면은 계속 원본을 쓴다. 썸네일이 없으면 목록은 원본으로 대신 보여 준다(onerror).

사용: python3 tools/make-thumbs.py          (없거나 원본보다 오래된 썸네일만 새로 만듦)
      python3 tools/make-thumbs.py --all    (전부 다시 만듦)
필요: Pillow (pip install Pillow)
"""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "images", "partners", "full")
DST = os.path.join(ROOT, "images", "partners", "thumb")
WIDTH = 400
QUALITY = 82


def main():
    redo = "--all" in sys.argv
    os.makedirs(DST, exist_ok=True)
    made = skipped = 0
    before = after = 0
    for name in sorted(os.listdir(SRC)):
        if not name.endswith(".webp"):
            continue
        src, dst = os.path.join(SRC, name), os.path.join(DST, name)
        if not redo and os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
            skipped += 1
            continue
        im = Image.open(src)
        im.load()
        if im.width > WIDTH:
            im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
        im.save(dst, "WEBP", quality=QUALITY, method=6)
        before += os.path.getsize(src)
        after += os.path.getsize(dst)
        made += 1
    print(f"썸네일 {made}개 만듦, {skipped}개는 그대로" + (f" · 원본 {before / 1024:.0f}KB → {after / 1024:.0f}KB" if made else ""))


if __name__ == "__main__":
    main()
