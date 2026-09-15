# 타격음 출처

전부 [Pixabay](https://pixabay.com) 무료 라이선스 (Pixabay Content License).
상업적 사용 가능, 출처 표기 의무 없음. 아래는 기록용.

제작자: **Universfield**

| 파일 | 원제 | 게임 내 용도 | 원본 |
|---|---|---|---|
| `punch-jab.mp3` | Classic Punch Impact | 잽 · 플리커 | https://pixabay.com/ko/sound-effects/classic-punch-impact-352711/ |
| `punch-hook.mp3` | Punch Impact Hit | 훅 · 카운터 · 필살기 · 가드브레이크 | https://pixabay.com/ko/sound-effects/punch-impact-hit-567196/ |
| `punch-follow.mp3` | Punch | 뎀프시 연타 등 후속타 | https://pixabay.com/ko/sound-effects/punch-140236/ |
| `punch-body.mp3` | Punch 03 | 보디 · 리버 · 착지 | https://pixabay.com/ko/sound-effects/punch-03-352040/ |

## 가공

원본은 1.4~1.6초 스테레오 256kbps. 타격음으로 쓰려고 아래를 적용했다.

```
ffmpeg -i <원본> \
  -af "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0:detection=peak,\
       atrim=0:0.42,afade=t=out:st=0.40:d=0.02,\
       loudnorm=I=-14:TP=-1.0:LRA=11,alimiter=limit=0.95" \
  -ac 1 -ar 44100 -b:a 96k <출력>
```

앞 무음 제거 → 0.42초 컷 → 끝 페이드(클릭 방지) → 라우드니스 정규화 → 모노 96kbps.
합계 168KB → **24KB**.
