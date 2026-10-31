# -*- coding: utf-8 -*-
"""
卡通 IP 形象动画 v2：新视频「专属卡通IP形象设计需求2.mp4」
==========================================================
- 只取 6.5s~15s 的"不转身"片段（正面站立 + 微笑小动作），
  0.8~6.8s 的转身段按用户要求剪掉
- 每帧复用 process_ip 的抠像流程（floodFill 背景 + despill）
- 所有帧对齐到统一画布：人物水平居中 + 底部对齐
- 输出：透明 WebM（VP8 + alpha_mode=1）+ 增强静态 PNG
"""
import cv2
import numpy as np
from PIL import Image
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
from process_ip import make_alpha, despill  # 复用抠像核心

OUT_DIR = Path(__file__).parent
VIDEO = r"D:\videcoding\专属卡通IP形象设计需求2.mp4"  # 新视频
# 待机剪辑段（帧号 @24fps）：6.8~7.8s 纯正面站立（无回眸、无半截比心）
CLIP_RANGES: list[tuple[int, int]] = [(163, 187)]
TARGET_H = 624          # 成品高度（16 的倍数，避免编码器拉伸）
SAMPLE_STEP = 2         # 每 2 帧抽 1 → 12fps
DURATION_MS = 83        # 每帧 83ms ≈ 12fps
STATIC_FRAME = 180      # 静态主形象取第 180 帧（≈7.5s，正面微笑）


def collect_character_frames() -> list[np.ndarray]:
    """按 CLIP_RANGES 多段抽帧（跳过转圈段）→ 抠像 → 返回 BGRA 帧列表。
    结果缓存在 anim_frames_v3/，调编码参数时无需重新抠像。"""
    cache_dir = OUT_DIR / "anim_frames_v3"
    if cache_dir.exists() and len(list(cache_dir.glob("f_*.png"))) > 10:
        files = sorted(cache_dir.glob("f_*.png"), key=lambda p: int(p.stem.split("_")[1]))
        print(f"使用缓存帧：{len(files)} 张")
        return [cv2.imread(str(p), cv2.IMREAD_UNCHANGED) for p in files]

    cap = cv2.VideoCapture(VIDEO)
    frames = []
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        in_range = any(s <= idx < e for s, e in CLIP_RANGES)
        local_idx = next((idx - s for s, e in CLIP_RANGES if s <= idx < e), 0)
        if in_range and local_idx % SAMPLE_STEP == 0:
            alpha = make_alpha(frame)
            clean = despill(frame)
            ys, xs = np.where(alpha > 24)
            if len(ys):  # 找到人物才收
                y0, y1 = ys.min(), ys.max() + 1
                x0, x1 = xs.min(), xs.max() + 1
                rgba = cv2.cvtColor(clean, cv2.COLOR_BGR2BGRA)
                rgba[..., 3] = alpha
                frames.append(rgba[y0:y1, x0:x1])
        idx += 1
    cap.release()
    cache_dir.mkdir(exist_ok=True)
    for i, f in enumerate(frames):
        cv2.imwrite(str(cache_dir / f"f_{i:04d}.png"), f)
    return frames


def align_to_canvas(frames: list[np.ndarray]) -> list[np.ndarray]:
    """统一画布：按最大宽高建画布，人物水平居中、底部对齐，再整体缩放"""
    max_h = max(f.shape[0] for f in frames)
    max_w = max(f.shape[1] for f in frames)
    scale = TARGET_H / max_h
    # 宽度也取 16 的倍数（VP9 编码兼容，避免自动缩放）
    canvas_w = (int(max_w * scale) + 15) // 16 * 16
    out = []
    for f in frames:
        scaled = cv2.resize(f, None, fx=scale, fy=scale,
                            interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LANCZOS4)
        h, w = scaled.shape[:2]
        canvas = np.zeros((TARGET_H, canvas_w, 4), np.uint8)
        x_off = (canvas_w - w) // 2
        y_off = TARGET_H - h
        canvas[y_off:y_off + h, x_off:x_off + w] = scaled
        out.append(canvas)
    return out


def sharpen_frame(rgba: np.ndarray) -> np.ndarray:
    """轻锐化（清晰度增强；动画帧显示尺寸小，轻量即可）"""
    bgr = rgba[..., :3].copy()
    blur = cv2.GaussianBlur(bgr, (0, 0), 1.8)
    bgr = cv2.addWeighted(bgr, 1.45, blur, -0.45, 0)
    out = rgba.copy()
    out[..., :3] = bgr
    return out


def encode_webm(pil_frames: list, dest: Path) -> None:
    """
    编码成带透明通道的 WebM（VP8 + ALPHA_MODE 元数据，Chromium/Edge/Firefox 均支持）。
    说明：这个 ffmpeg 构建的 libvpx-vp9 编 yuva420p 会报内部错误，VP8 的
    alpha side-data 路径是 WebM 透明动画的原始标准方案，浏览器支持最稳。
    """
    import imageio_ffmpeg
    import subprocess
    import tempfile

    ff = imageio_ffmpeg.get_ffmpeg_exe()
    tmp_dir = Path(tempfile.mkdtemp(prefix="ip_frames_"))
    try:
        for i, f in enumerate(pil_frames):
            # 存回 BGRA 给 OpenCV 写 PNG（无损、保留 alpha）
            cv2.imwrite(str(tmp_dir / f"f_{i:04d}.png"),
                        cv2.cvtColor(np.asarray(f), cv2.COLOR_RGBA2BGRA))
        cmd = [ff, "-y", "-framerate", str(round(1000 / DURATION_MS)),
               "-i", str(tmp_dir / "f_%04d.png"),
               "-c:v", "libvpx", "-pix_fmt", "yuva420p",
               "-auto-alt-ref", "0",
               "-metadata:s:v:0", "alpha_mode=1",
               "-b:v", "1400k", "-deadline", "good", "-cpu-used", "2",
               str(dest), "-loglevel", "error"]
        subprocess.run(cmd, check=True)
    finally:
        import shutil
        shutil.rmtree(tmp_dir, ignore_errors=True)


def make_static_enhanced() -> None:
    """静态主形象（新视频 STATIC_FRAME 帧）：抠像 + 对比度/饱和度/多尺度锐化 + 2x 放大"""
    cap = cv2.VideoCapture(VIDEO)
    cap.set(cv2.CAP_PROP_POS_FRAMES, STATIC_FRAME)
    ok, frame = cap.read()
    cap.release()
    assert ok, "静态帧读取失败"

    alpha = make_alpha(frame)
    clean = frame.astype(np.int16)
    limit = np.maximum(clean[..., 0], clean[..., 2]) + 2  # despill
    clean[..., 1] = np.minimum(clean[..., 1], limit)
    clean = clean.astype(np.uint8)

    lab = cv2.cvtColor(clean, cv2.COLOR_BGR2LAB)   # 轻对比度
    lab[..., 0] = cv2.createCLAHE(1.2, (8, 8)).apply(lab[..., 0])
    clean = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    hsv = cv2.cvtColor(clean, cv2.COLOR_BGR2HSV).astype(np.int16)  # 饱和度 +8%
    hsv[..., 1] = np.clip(hsv[..., 1] * 1.08, 0, 255)
    clean = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    for radius, amt in ((2.5, 0.5), (1.2, 0.32)):  # 多尺度锐化
        blur = cv2.GaussianBlur(clean, (0, 0), radius)
        clean = cv2.addWeighted(clean, 1 + amt, blur, -amt, 0)

    crop = np.dstack([clean, alpha])
    ys, xs = np.where(alpha > 24)
    y0, y1 = max(0, ys.min() - 12), min(frame.shape[0], ys.max() + 12)
    x0, x1 = max(0, xs.min() - 18), min(frame.shape[1], xs.max() + 18)
    big = cv2.resize(crop[y0:y1, x0:x1], None, fx=2, fy=2, interpolation=cv2.INTER_LANCZOS4)
    b3 = cv2.GaussianBlur(big[..., :3], (0, 0), 1.0)
    big[..., :3] = cv2.addWeighted(big[..., :3], 1.25, b3, -0.25, 0)

    cv2.imwrite(str(OUT_DIR / "ip_v2_static.png"), big)
    print(f"静态形象完成：{big.shape[1]}x{big.shape[0]} → ip_v2_static.png")


def main():
    print("抽帧抠像中…（有缓存则秒出）")
    frames = collect_character_frames()
    print(f"抠像完成：{len(frames)} 帧")
    # 待机用"正放+倒放"乒乓循环：正面站立呼吸感，无跳帧、无半截动作
    frames = frames + frames[-2:0:-1]
    frames = align_to_canvas(frames)
    frames = [sharpen_frame(f) for f in frames]
    pil_frames = [Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGRA2RGBA))
                  for f in frames]

    dest = OUT_DIR / "mascot_anim.webm"
    encode_webm(pil_frames, dest)
    size_mb = dest.stat().st_size / 1024 / 1024
    print(f"动画完成：{dest.name} | {len(pil_frames)} 帧 | {size_mb:.2f} MB")

    make_static_enhanced()

    # 顺手存一张中间帧预览（检查抠像质量）
    cv2.imwrite(str(OUT_DIR / "anim_frame_check.jpg"),
                frames[len(frames) // 2][..., :3])


if __name__ == "__main__":
    main()
