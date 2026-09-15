# 타격음 출처

전부 [Pixabay](https://pixabay.com) 무료 라이선스 (Pixabay Content License).
상업적 사용 가능, 출처 표기 의무 없음. 아래는 기록용.

제작자: 파일마다 다름 — 아래 표 참조.

| 파일 | 원제 | 게임 내 용도 | 원본 |
|---|---|---|---|
| `punch-jab.mp3` | Classic Punch Impact | 잽 · 플리커 | https://pixabay.com/ko/sound-effects/classic-punch-impact-352711/ |
| `punch-hook.mp3` | Punch Impact Hit | 훅 · 카운터 · 필살기 · 가드브레이크 | https://pixabay.com/ko/sound-effects/punch-impact-hit-567196/ |
| `punch-follow.mp3` | Punch | 뎀프시 연타 등 후속타 | https://pixabay.com/ko/sound-effects/punch-140236/ |
| `punch-body.mp3` | Punch 03 | 보디 · 리버 · 착지 | https://pixabay.com/ko/sound-effects/punch-03-352040/ |
| `bell.mp3` | Boxing Bell | 라운드 공 (경기 시작 · 교대 출전) | https://pixabay.com/ko/sound-effects/boxing-bell-122093/ |
| `counter.mp3` | indy_hit1 (Alice_soundz) | 반격기 적중 | https://pixabay.com/ko/sound-effects/indy-hit1-224072/ |
| `crowd.mp3` | Crowd Clapping and Cheering Effect (11325622) | 경기 중 관중 앰비언스 루프 | https://pixabay.com/ko/sound-effects/crowd-clapping-and-cheering-effect-272056/ |
| `lightning.mp3` | Lightning Strike (DRAGON-STUDIO) | 뎀프시롤 좌우 훅 | https://pixabay.com/ko/sound-effects/lightning-strike-386161/ |
| `block.mp3` | Slap Hurt Pain Sound Effect (Homemade_SFX) | 가드로 막았을 때 | https://pixabay.com/ko/sound-effects/slap-hurt-pain-sound-effect-262618/ |

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

종소리는 울림(테일)이 소리의 핵심이라 더 길게 남긴다 (앞 무음 제거 + 2.6초 컷, 15.6s/489KB → 2.6s/31KB):

```
ffmpeg -i <원본> \
  -af "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0:detection=peak,\
       atrim=0:2.6,afade=t=out:st=2.45:d=0.15,loudnorm=I=-15:TP=-1.0:LRA=11" \
  -ac 1 -ar 44100 -b:a 96k bell.mp3
```


## 루프 처리 (crowd.mp3)

관중음은 페이드를 넣지 않는다 — 넣으면 이음새마다 음량이 꺼졌다 켜진다.
대신 Web Audio 의 `loopStart`/`loopEnd` 를 버퍼 안쪽(0.12초 ~ 끝-0.12초)으로 잡아
mp3 인코더 패딩(앞뒤 무음)을 루프 구간에서 제외한다.

6.75초 한 버퍼를 재생 속도 1.0 / 0.873 두 겹으로, 시작 위치를 2.6초 어긋나게 깔아
반복 주기가 귀에 띄지 않게 만든다. 좌우로도 갈라 놓는다(pan ∓0.35).
