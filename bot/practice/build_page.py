# pratik.html üretici: egitim.html stil + grafik motoru + docs/pratik/candles.json (son 90 gün 1D, 120 mum 4H) + şablon.
# Kullanım: python3 bot/practice/build_page.py
import json, re, sys
src = open('egitim.html').read()
css = re.search(r'<style>\n(.*?)</style>', src, re.S).group(1)
eng = src.split("/* ---------- yardımcılar ---------- */",1)[1].split("/* ============ GRAFİK VERİLERİ ============ */",1)[0]
d = json.load(open('docs/pratik/candles.json'))
data = {'generatedAt': d['generatedAt'], 'coins': {c: {'1D': d['coins'][c]['1D'][-90:], '4H': d['coins'][c]['4H'][-120:], '1H': d['coins'][c]['1H'][-80:]} for c in ['BTC','ETH']}}
body = open(sys.argv[1] if len(sys.argv) > 1 else 'bot/practice/pratik_template.html').read()
html = body.replace('/*CSS*/', css).replace('/*ENGINE*/', eng).replace('/*DATA*/', json.dumps(data, separators=(',',':')))
open('pratik.html','w').write(html)
print(len(html))
