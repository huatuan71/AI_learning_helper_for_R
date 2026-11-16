"""Verify a deployed HTTPS app before creating its release note and URL QR."""
import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen

import qrcode
import qrcode.image.svg

ROOT = Path(__file__).resolve().parents[1]
DELIVERABLES_ROOT = ROOT.parent / 'docs' / 'deliverables'


def publish(url):
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path not in {'', '/'} or any(ord(c) < 33 for c in url)):
        raise ValueError('请提供正式HTTPS应用根地址')
    base = url.rstrip('/')
    with urlopen(base + '/api/health', timeout=30) as response:
        if urlsplit(response.geturl()).scheme != 'https':
            raise ValueError('公网健康接口须保持HTTPS')
        health = json.load(response)
    if health.get('version') != '1.2.1' or health.get('counts', {}).get('knowledge') != 43:
        raise ValueError('公网服务版本或课程数量不符合本次交付')
    with urlopen(base + '/', timeout=30) as response:
        if urlsplit(response.geturl()).scheme != 'https':
            raise ValueError('公网首页须保持HTTPS')
        if 'model-dialog' not in response.read().decode('utf-8'):
            raise ValueError('公网首页未包含模型设置')
    destination = ROOT / 'output' / 'release'
    destination.mkdir(parents=True, exist_ok=True)
    image = qrcode.make(base + '/', image_factory=qrcode.image.svg.SvgPathImage)
    image.save(destination / 'qrcode.svg')
    date = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds')
    note = f'''# 发布信息

应用版本为1.2.1，发布日期为{date}。

- 公网地址为 [{base}]({base}/)。
- 二维码文件为 `ai_tutor/output/release/qrcode.svg`。
- 已由脚本核验HTTPS健康接口、43个知识点和模型设置页面。
- 真实账号问答、搜索、手机蜂窝扫码及两设备并发待人工验收并记录。

服务采用单实例、单worker。Key按浏览器会话保存在服务器内存，服务重启后需重新配置。
'''
    (DELIVERABLES_ROOT / 'release.md').write_text(note, encoding='utf-8')
    print('公网基础检查通过，已生成发布信息与二维码。手机及真实调用结果需继续补充。')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    publish(parser.parse_args().url)
