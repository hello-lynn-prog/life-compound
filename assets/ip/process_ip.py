# -*- coding: utf-8 -*-
"""
卡通 IP 形象处理 v3
==================
核心改进：背景识别从"逐像素颜色分类"改为 cv2.floodFill 色彩距离生长——
从画面四边种子出发，按 H/S/V 容差逐步"吃掉"渐变区域，
能穿透灯光明暗、地面/墙面分界、脚下阴影（这些都是连续渐变），
到人物边缘（色差大）自然停下。

其他修正（对应两轮验收反馈）：
- 脚底阴影：floodFill 直接从地面长进阴影；再加底部区域兜底清理
- 死白/过锐：锐化权重回调
- 发丝破洞：边缘腐蚀从 2px 降回 1px
"""
import cv2
import numpy as np
from pathlib import Path

VIDEO = r"D:\videcoding\专属卡通IP形象设计需求.mp4"
OUT_DIR = Path(r"D:\videcoding\life-compound\assets\ip")


def build_bg_mask(bgr: np.ndarray) -> np.ndarray:
    """从画面边缘 floodFill 生长出背景（含渐变、阴影、地面分界）"""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h_, w_ = hsv.shape[:2]
    combined = np.zeros((h_, w_), np.uint8)

    # floodFill 容差：FIXED_RANGE 模式（相对种子点颜色比较，不会随渐变无限延伸）。
    # 容差足够覆盖背景自身的明暗渐变/阴影，但小于"背景灰绿 ↔ 人物米白/黑发"的色差
    lo, up = (18, 45, 45), (18, 45, 45)
    flags = (4 | cv2.FLOODFILL_MASK_ONLY | cv2.FLOODFILL_FIXED_RANGE | (255 << 8))

    seeds = []
    for x in range(8, w_ - 8, 32):
        seeds += [(6, x), (h_ - 7, x)]
    for y in range(8, h_ - 8, 32):
        seeds += [(y, 6), (y, w_ - 7)]

    for seed in seeds:
        # 只从"确实是绿色调"的种子出发（seed 存的是 (y, x)）
        px = hsv[seed[0], seed[1]]
        if not (35 <= int(px[0]) <= 95 and int(px[1]) >= 22):
            continue
        flood = np.zeros((h_ + 2, w_ + 2), np.uint8)
        work = hsv.copy()
        cv2.floodFill(work, flood, (seed[1], seed[0]), 0, loDiff=lo, upDiff=up, flags=flags)
        combined = cv2.bitwise_or(combined, flood[1:-1, 1:-1])
    return combined


def cleanup_shadow_near_feet(bgr: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """
    兜底：人物包围盒底部一带（最后 16% 高度），把土黄/灰绿的
    阴影残留剔掉。白鞋/米白裤（饱和度很低）不受影响。
    """
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0].astype(int), hsv[..., 1].astype(int), hsv[..., 2].astype(int)
    # 阴影特征：黄绿到土黄色相（20-95）且有一定饱和度
    shadowy = (h >= 20) & (h <= 95) & (s >= 16) & (v <= 240)

    ys = np.where((alpha > 0).any(axis=1))[0]
    if not len(ys):
        return alpha
    bottom_band = np.zeros_like(alpha, bool)
    y_start = int(ys.min() + (ys.max() - ys.min()) * 0.84)
    bottom_band[y_start:, :] = True

    alpha[(alpha > 0) & bottom_band & shadowy] = 0
    return alpha


def make_alpha(bgr: np.ndarray) -> np.ndarray:
    alpha = cv2.bitwise_not(build_bg_mask(bgr))
    # 最大连通域（人物）
    n, labels, stats, _ = cv2.connectedComponentsWithStats(alpha, 8)
    if n > 2:
        biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        alpha = np.where(labels == biggest, 255, 0).astype(np.uint8)
    # 底部阴影兜底清理
    alpha = cleanup_shadow_near_feet(bgr, alpha)
    # 清理后重新保最大连通域 + 轻闭运算
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), 1)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(alpha, 8)
    if n > 2:
        biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        alpha = np.where(labels == biggest, 255, 0).astype(np.uint8)
    # 去绿边：腐蚀 1px + 羽化
    alpha = cv2.erode(alpha, np.ones((3, 3), np.uint8), iterations=1)
    alpha = cv2.GaussianBlur(alpha, (5, 5), 0)
    return alpha


def despill(bgr: np.ndarray) -> np.ndarray:
    """绿溢出校正：G 压到 max(R,B)+2"""
    out = bgr.astype(np.int16)
    limit = np.maximum(out[..., 0], out[..., 2]) + 2
    out[..., 1] = np.minimum(out[..., 1], limit)
    return out.astype(np.uint8)


def enhance(bgra: np.ndarray) -> np.ndarray:
    """清晰度：轻细节增强 + 适度锐化 + 2 倍 Lanczos 放大"""
    bgr = cv2.detailEnhance(bgra[..., :3], sigma_s=8, sigma_r=0.10)
    blur = cv2.GaussianBlur(bgr, (0, 0), 2.5)
    bgr = cv2.addWeighted(bgr, 1.55, blur, -0.55, 0)
    out = np.dstack([bgr, bgra[..., 3]])
    return cv2.resize(out, None, fx=2, fy=2, interpolation=cv2.INTER_LANCZOS4)


def extract_frame(idx: int, tag: str) -> None:
    cap = cv2.VideoCapture(VIDEO)
    cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        print(f"{tag}: 读帧失败"); return

    alpha = make_alpha(frame)
    clean = despill(frame)

    ys, xs = np.where(alpha > 24)
    if not len(ys):
        print(f"{tag}: 未找到人物"); return
    pad_y, pad_x = int((ys.max()-ys.min())*0.02), int((xs.max()-xs.min())*0.03)
    y0, y1 = max(0, ys.min()-pad_y), min(frame.shape[0], ys.max()+pad_y)
    x0, x1 = max(0, xs.min()-pad_x), min(frame.shape[1], xs.max()+pad_x)
    final = enhance(np.dstack([clean[y0:y1, x0:x1], alpha[y0:y1, x0:x1]]))

    cv2.imwrite(str(OUT_DIR / f"ip_{tag}.png"), final)
    a = final[..., 3:4].astype(float) / 255
    checker = np.zeros_like(final[..., :3])
    for yy in range(0, checker.shape[0], 16):
        for xx in range(0, checker.shape[1], 16):
            c = 235 if ((yy//16 + xx//16) % 2 == 0) else 205
            checker[yy:yy+16, xx:xx+16] = c
    comp = (final[..., :3] * a + checker * (1 - a)).astype(np.uint8)
    cv2.imwrite(str(OUT_DIR / f"ip_{tag}_preview.jpg"), comp, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print(f"{tag}: 帧{idx} → {final.shape[1]}x{final.shape[0]}")


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for idx, tag in [(90, "a"), (150, "b"), (210, "c")]:
        extract_frame(idx, tag)
    print("v3 完成")
