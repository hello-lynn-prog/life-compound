# -*- coding: utf-8 -*-
"""
手势动画抽取：从 v2 视频剪出「挥手打招呼」「比心」两段
====================================================
- 与待机动画同一套抠像 + 画布对齐管线（切换时不跳位）
- 输出透明 WebM（VP8 + alpha_mode=1）
- wave:  8.4~11.0s（挥手段）
- heart: 11.8~14.6s（比手段，收在正面双手合握）
"""
import cv2
import numpy as np
from PIL import Image
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).parent))
from process_ip import make_alpha, despill
from make_animation import VIDEO, TARGET_H, OUT_DIR, encode_webm

DURATION_MS = 83  # 12fps，与待机一致

# 手势段（帧号 @24fps）——经逐帧核对的真实动作位置（全程正面）
GESTURES = {
    "wave":  (211, 245),   # 8.8 ~ 10.2s 举手挥动
    "heart": (182, 211),   # 7.6 ~ 8.8s  双手比心
}


def load_idle_canvas_size() -> tuple[int, int]:
    """用待机帧缓存推算统一画布尺寸（与 align_to_canvas 同一套公式）"""
    cache = OUT_DIR / "anim_frames_v3"
    files = sorted(cache.glob("f_*.png"))
    frames = [cv2.imread(str(p), cv2.IMREAD_UNCHANGED) for p in files]
    max_h = max(f.shape[0] for f in frames)
    max_w = max(f.shape[1] for f in frames)
    scale = TARGET_H / max_h
    canvas_w = (int(max_w * scale) + 15) // 16 * 16
    return canvas_w, TARGET_H


def extract_gesture(name: str, start: int, end: int, canvas_w: int, canvas_h: int) -> None:
    cache = OUT_DIR / f"gesture_{name}"
    if cache.exists() and len(list(cache.glob("f_*.png"))) > 5:
        print(f"{name}: 使用缓存帧")
    else:
        cap = cv2.VideoCapture(VIDEO)
        cap.set(cv2.CAP_PROP_POS_FRAMES, start)
        frames = []
        idx = start
        while idx < end:
            ok, frame = cap.read()
            if not ok:
                break
            # 隔帧抽取（24fps 源 → 12fps 动画，速度与待机一致）
            if (idx - start) % 2 == 0:
                alpha = make_alpha(frame)
                clean = despill(frame)
                ys, xs = np.where(alpha > 24)
                if len(ys):
                    rgba = cv2.cvtColor(clean, cv2.COLOR_BGR2BGRA)
                    rgba[..., 3] = alpha
                    frames.append(rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
            idx += 1
        cap.release()
        cache.mkdir(exist_ok=True)
        for i, f in enumerate(frames):
            cv2.imwrite(str(cache / f"f_{i:04d}.png"), f)
        print(f"{name}: 抽取 {len(frames)} 帧")

    # 对齐到与待机一致的画布：水平居中 + 底部对齐 + 同样缩放
    files = sorted(cache.glob("f_*.png"), key=lambda p: int(p.stem.split("_")[1]))
    frames = [cv2.imread(str(p), cv2.IMREAD_UNCHANGED) for p in files]
    scale = TARGET_H / max(f.shape[0] for f in frames)
    pil_frames = []
    for f in frames:
        scaled = cv2.resize(f, None, fx=scale, fy=scale,
                            interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LANCZOS4)
        h, w = scaled.shape[:2]
        canvas = np.zeros((canvas_h, canvas_w, 4), np.uint8)
        canvas[canvas_h - h:, (canvas_w - w) // 2:(canvas_w - w) // 2 + w] = scaled
        pil_frames.append(Image.fromarray(cv2.cvtColor(canvas, cv2.COLOR_BGRA2RGBA)))

    dest = OUT_DIR / f"gesture_{name}.webm"
    encode_webm(pil_frames, dest)
    print(f"{name}: {dest.name} | {len(pil_frames)} 帧 | {dest.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    W, H = load_idle_canvas_size()
    print(f"统一画布：{W}x{H}")
    for name, (s, e) in GESTURES.items():
        extract_gesture(name, s, e, W, H)
    # 拷进前端资源
    import shutil as sh
    for name in GESTURES:
        sh.copy(OUT_DIR / f"gesture_{name}.webm",
                OUT_DIR.parent.parent / "frontend" / "src" / "assets" / f"mascot_{name}.webm")
    print("已复制到前端资源")
