# Dempsey Boxing — 현행 구현 실측 테스트 리포트

측정일: 2026-09-16
측정 환경: Apple M1 Pro / Chrome (Playwright) / ANGLE Metal / WebGL 2.0 / 120Hz
서버: `serve.py` @ :8787, 엔트리 `dev.html`

> **측정 한계 (해석 시 반드시 감안)**
> - 헤드리스 브라우저라 `devicePixelRatio = 1`. 실제 Retina(2x)는 픽셀 4배 → 아래 dpr 스케일링 표 참조
> - 실제 모바일 GPU 미측정. 모바일 항목은 뷰포트/레이아웃 검증만
> - WebGPU는 브라우저에서 사용 가능(`navigator.gpu` 존재)하나, 게임은 `WebGLRenderer`로 동작 중

---

## 1. 요약

| 항목 | 결과 |
|---|---|
| 로드 / 부팅 | 정상. JS 에러 0 |
| 게임플레이 루프 | 정상. 입력·피격·데미지·KO·재시작 동작 확인 |
| 성능 (데스크톱) | **목표 크게 상회.** 전투 중 118fps (8.48ms) |
| photoreal 모드 비용 | **약 2%** (8.48ms → 8.65ms) — 거의 공짜 |
| 폴리곤 예산 | 씬 전체 80k tris. **실사 에셋 넣을 여유 매우 큼** |
| 전송량 | 1.2MB / 65 요청. DOMContentLoaded 81ms |
| **발견된 결함** | **3건 (아래 5장)** |

**결론: 성능은 병목이 아니다. 화질의 병목은 전적으로 에셋과 배경이다.**

---

## 2. 성능 실측

### 2-1. 전투 중 프레임타임 (dpr 1, 1440x900)

| 경로 | 평균 | fps | p95 | p99 | 최악 |
|---|---|---|---|---|---|
| baseline (`PostFX`) | 8.48ms | 118.0 | 9.8ms | 14.3ms | 38.6ms |
| photoreal (`PhotorealPostFX`) | 8.65ms | 115.6 | 10.0ms | 16.2ms | 53.9ms |

photoreal 스택(N8AO + SelectiveBloom + DOF + AgX + SMAA + Vignette/Noise/CA) 전체가 **0.17ms**.
이 하드웨어에서는 포스트프로세싱이 비용 요인이 아니다.

### 2-2. 해상도 스케일 부하 (photoreal)

| pixelRatio | 백버퍼 | 평균 | fps | p95 | 최악 |
|---|---|---|---|---|---|
| 1.0 | 1440x900 | 8.28ms | 120.7 | 9.3ms | 10.1ms |
| 1.5 | 2160x1350 | 11.62ms | 86.0 | 14.6ms | 18.9ms |
| 2.0 | *1224x765* | 9.71ms | 103.0 | 19.3ms | **101.5ms** |
| 3.0 | *1007x630* | 15.26ms | 65.5 | 43.1ms | **186.1ms** |

*기울임 = `ResolutionGovernor`가 과부하를 감지해 스스로 해상도를 낮춘 값.*

**판정 2건:**
- ✅ `ResolutionGovernor` 정상 작동. 과부하 시 실제로 백버퍼를 줄인다
- ⚠️ **해상도 전환 순간 101~186ms 스톨** 발생. 렌더타겟 재할당 + 셰이더 재컴파일 추정.
  전투 중 트리거되면 명백한 프리징으로 보인다 → 개선 대상

### 2-3. 모바일 가로 뷰포트 (844x390, 데스크톱 GPU)

평균 9.32ms / 107fps / p95 9.3ms. HUD 가로 오버플로 없음. 카메라 aspect 정상 추종.

---

## 3. 씬 구성 분석 (실사감 진단의 핵심)

```
배경          : Color #000000  +  FogExp2 #000000   ← 아레나 자체가 없음. 순수 void
환경맵(IBL)   : baseline = 없음 / photoreal = 있음 (intensity 0.65)
톤매핑        : baseline = ACESFilmic (exp 0.9) / photoreal = AgX (exp 1.0)
조명          : SpotLight 240 (그림자 O, 2048px) + DirectionalLight 0.6, 0.85 (그림자 X)
그림자맵 타입 : PCFShadowMap
씬 총 폴리곤  : 80,032 tris
그림자 캐스터 : 316개  /  리시버 302개
```

### 머티리얼 텍스처 보유 현황

| 머티리얼 | 개수 | map | normalMap | roughnessMap | aoMap |
|---|---|---|---|---|---|
| MeshPhysicalMaterial | 300 | **0** | **0** | **0** | **0** |
| MeshStandardMaterial | 24 | 1 | **0** | **0** | **0** |
| MeshBasicMaterial | 9 | 6 | - | - | - |

**씬 전체에서 PBR 텍스처 맵이 사실상 0개다.** 모든 오브젝트가 단색이다.
실사감이 안 나는 이유의 1순위이며, 렌더러·포스트프로세싱으로는 절대 보정되지 않는다.

### 시각 확인 (`test-shots/`)

- `02-fight-default.png` — baseline. 링 밖 완전 검정, 캐릭터는 박스 프리미티브 조립, 플랫 셰이딩
- `04-photoreal-fight.png` — photoreal. 조명 그라데이션·블룸·비네팅으로 **확연히 개선**. 배경 void는 동일
- `05-mobile-landscape.png` — 모바일 가로. UI 잘림 (5-2 참조)

---

## 4. 전송량 / 로딩

| 호스트 | 요청 | 전송 | 디코드 |
|---|---|---|---|
| localhost (게임 코드+에셋) | 36 | 1,002KB* | 992KB |
| cdn.jsdelivr.net (three/postprocessing/n8ao) | 6 | 223KB | 2,096KB |
| fonts.gstatic + googleapis | 22 | (캐시) | 355KB |
| **합계** | **65** | **1,226KB** | **3,442KB** |

\* 로컬 `serve.py`는 압축을 하지 않는다. GitHub Pages는 Brotli가 적용되므로 실제 배포 전송량은 더 작다.
참고 gzip 실측: `js/*.js` 431KB → **129KB**, `arena-original.hdr` 512KB → **33KB**

DOMContentLoaded 81ms / load 165ms. 최대 단일 파일은 `arena-original.hdr` 512KB.

---

## 5. 발견된 결함

### 5-1. ✅ [해결] photoreal 전용 — 렌더타겟 피드백 루프

```
[WARNING] GL_INVALID_OPERATION: glDrawArrays:
          Feedback loop formed between Framebuffer and active Texture.
```

- **발생 조건**: photoreal 모드 + 전투 중 (`impactPass`가 켜지는 순간)
- **미발생**: baseline 경로에서는 동일 전투 시퀀스에 경고 0건 → **photoreal 전용**

**원인** — `js/PhotorealPostFX.js`의 `BoxingImpact` 이펙트:

```js
this.impact = new P.Effect('BoxingImpact', `
  ...
  color += texture2D(inputBuffer, uv - offset * .33).rgb * .3;   // ← 현재 프래그먼트가 아닌 UV에서 샘플링
  color += texture2D(inputBuffer, uv - offset * .66).rgb * .2;
  color += texture2D(inputBuffer, uv - offset).rgb * .1;
`, { blendFunction: P.BlendFunction.NORMAL, uniforms: ... });
```

`inputBuffer`를 **오프셋 UV로 샘플링**(=convolution)하는데 `EffectAttribute.CONVOLUTION`을 선언하지 않았다.
런타임 확인: `impact.getAttributes() === 0` (NONE), `EffectAttribute.CONVOLUTION === 2`.

pmndrs/postprocessing은 CONVOLUTION 속성이 없는 이펙트를 다른 이펙트와 한 패스로 병합하고 입출력 버퍼를 공유할 수 있게 둔다.
그 결과 같은 텍스처를 읽으면서 동시에 쓰게 되어 피드백 루프가 된다. 해당 패스의 출력은 정의되지 않은 값이 된다.

**정정** — 위 진단은 불완전했다. `EffectAttribute.CONVOLUTION` 을 선언해도 루프는 그대로 재현됐다.

패스를 하나씩 끄며 격리한 실측 결과:

| 구성 | 경고 |
|---|---|
| 충돌 블러만 (AO 끔) | 0 |
| AO 만 (충돌 블러 끔) | 0 |
| AO → 충돌 블러 | **발생** |
| 충돌 블러 → AO | 0 |
| 충돌 블러 + DOF (Bloom 뒤) | **발생** |
| 충돌 블러 + DOF (Bloom 앞) | 0 |

**실제 원인**: `EffectComposer` 는 깊이 텍스처를 `inputBuffer` 에만 붙인다.
스왑하는 패스의 출력 대상은 `outputBuffer → inputBuffer → …` 로 번갈아 바뀌므로,
깊이를 샘플링하는 패스가 스왑 순번 **짝수**에 오면 깊이 텍스처를 가진 버퍼에 쓰면서 동시에 읽는다.
DOF 만 이 패리티에 민감하다 (AO·Bloom·SMAA 는 자체 타깃을 써서 무관).

충돌 블러 패스가 타격 때만 켜졌다 꺼졌다 하면서 뒤따르는 DOF 의 순번을 홀↔짝으로 흔든 것이 방아쇠였다.

**적용한 수정** (`js/PhotorealPostFX.js`):
1. 충돌 블러 패스를 AO 앞으로 옮기고 **항상 활성** 상태로 유지 (강도 0 이면 셰이더가 원본을 그대로 통과)
2. DOF 를 Bloom **앞**으로 이동 → DOF 는 어떤 구성에서도 3번째 스왑(홀수)으로 고정
3. `EffectAttribute.CONVOLUTION` 은 그대로 유지 (다중 탭 `inputBuffer` 샘플링에 필요)

**검증**: 프리셋 4종 × DOF on/off × 타격 유무 = 16개 구성 전부 경고 0.
실제 전투(이동·펀치·반격기) 3초 구간도 경고 0, 119.3fps / p99 10.3ms.

### 5-2. ✅ [해결] 모바일 가로 — 경기 후 캐릭터 선택 UI 도달 불가

844x390 뷰포트에서 `#next-overlay` 실측:

```
overlay 높이 = 1030px   (뷰포트 높이 390px)
overflow-y  = visible   → 스크롤 불가
.next-title    top: -649px   ← 화면 밖
.charsel       top: -610px   ← 캐릭터 카드 대부분 화면 밖
.corner-leave  top: -657px   ← "방 나가기" 버튼 도달 불가
```

`#start-overlay`는 `overflow: auto`가 있고 `@media (max-height: 520px)`에서 `.panel { zoom: .72 }`로 축소되지만,
`#next-overlay`에는 **둘 다 없다.** (`style.css:110`, `style.css:236~252`)

`#start-overlay, #next-overlay { touch-action: pan-y; }` 선언이 있는 걸 보면 스크롤을 의도했으나 실제 overflow가 빠져 있다.

**영향**: 실제 휴대폰 가로 모드(높이 390~430px)에서 경기 종료 후 **캐릭터를 고를 수도, 방을 나갈 수도 없다.**

**적용한 수정** (`style.css`):
1. `#next-overlay` 에 `max-height: 82vh; overflow-y: auto; overscroll-behavior: contain;` 부여
2. `.corner-leave`(방 나가기)는 스크롤 컨테이너 안에서 `position:absolute` 로는 내용과 함께 밀려 사라진다
   → `position: sticky; order: -1; align-self: flex-end` 로 오버레이 우상단에 고정 (전 해상도 공통)
3. `@media (max-height: 520px)` 에 `#next-overlay` 축소 규칙 추가 (카드 160px → 108px, 버튼·제목 축소)

**검증**: 844×390 / 667×375 / 1440×900 에서 제목·첫 카드·마지막 카드·다음 경기 시작·대기실로·방 나가기
6개 요소 전부 `elementFromPoint` 히트 테스트 통과. 가로 스크롤 없음.

### 5-3. 🟡 경미 — 404

- `assets/voice/manifest.json` 404 (`assets/voice/` 디렉터리는 존재하나 manifest 없음). 보이스 기능이 매 로드마다 실패
- `favicon.ico` 404

### 5-4. 🟡 경미 — 내장 측정 HUD의 드로우콜 오표시

photoreal 모드 하단 "그래픽 · 측정" 패널이 `1 draws`로 표시된다.
`renderer.info`는 `render()` 호출마다 리셋되므로 마지막 풀스크린 합성 패스만 집계된 값이다.
정확히 세려면 `renderer.info.autoReset = false` 후 프레임 경계에서 직접 `reset()` 해야 한다.
(동일 방식으로 직접 측정한 baseline 실제 값: **약 307 draws / 76k tris per frame**)

---

## 6. 개선 우선순위 (실측 기반 재정렬)

성능 여유가 예상보다 훨씬 크므로 `PHOTOREAL_UPGRADE_PROMPT.md`의 순서를 아래로 조정한다.

| 순위 | 작업 | 근거 |
|---|---|---|
| 1 | **5-1, 5-2 결함 수정** | 기능 결함. 화질 작업 전에 처리 |
| 2 | ~~photoreal 경로를 기본값으로 승격~~ **철회** | 레퍼런스 아트가 셀셰이딩 애니체로 확인됨. photoreal 경로는 툰 램프와 잉크 외곽선을 버려서 이 아트 디렉션에는 오히려 후퇴다. 상세는 `CHARACTER_REWORK.md` |
| 3 | **아레나 배경 제작** | 배경이 `#000000`인 게 실사감 저해 1순위. 관중석·조명 트러스·어두운 홀 |
| 4 | **PBR 텍스처 투입** | 머티리얼 300개 전부 맵 0개. albedo/normal/roughness/AO 풀세트 |
| 5 | 그림자 캐스터 316 → 축소 | 캐릭터·로프만 캐스팅, 정적물은 베이크 |
| 6 | 해상도 전환 스톨(최대 186ms) 제거 | RT 사전 할당 + `compileAsync` 예열 |
| 7 | 캐릭터 메시 실사화 | 폴리곤 예산 80k → LOD0 60k씩 써도 여유 |

**아트 디렉션 충돌 주의**: 현재 프로젝트는 `<title>`부터 "Anime Boxing"이고, 캐릭터는 의도적으로 박스 프리미티브로 조립된 애니/투톤 스타일이다.
실사 전환은 화질 개선이 아니라 **아트 디렉션 변경**이다. 진행 전에 이 방향이 맞는지 확정할 것.
