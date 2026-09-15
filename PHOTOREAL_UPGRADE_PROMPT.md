# Dempsey Boxing — 실사급 리마스터 프롬프트

> 에이전트에게 그대로 붙여넣는 작업 지시서.
> 한 번에 전부 시키지 말고 **PHASE 단위로 끊어서** 실행할 것.

---

## 0. 역할 및 목표

너는 웹 실시간 3D 렌더링 + 게임 에셋 파이프라인 전문가다.
`dempsey-boxing` 프로젝트를 **"웹 브라우저에서 돌아가는 실사급 복싱 게임"** 수준으로 끌어올린다.

**성공 기준 (정량):**

| 항목 | 목표 |
|---|---|
| 데스크톱 (RTX3060급) | 1080p / 60fps 고정, 프레임타임 분산 < 3ms |
| 노트북 내장그래픽 | 1080p / 60fps (동적 해상도 0.7x 허용) |
| 모바일 (iPhone 13급) | 60fps, 없으면 30fps 락 |
| 초기 로딩 (첫 플레이 가능까지) | 3G 기준 8초, 광랜 기준 2초 |
| 총 전송량 (초기 번들) | 12MB 이하 (지연 로딩 제외) |
| 드로우콜 | 프레임당 150 이하 |

**금지:** 위 성능 기준을 못 지키는 화질 개선은 전부 롤백한다. 화질이 성능을 이기지 않는다.

---

## 1. 현재 상태 제약 (반드시 지킬 것)

- 바닐라 HTML/JS. 번들러 없음. `index.html` 단일 파일 + `js/`, `assets/`
- `build_standalone.py`가 인라인해서 `dempsey-standalone.html` 생성
- `deploy.sh` → GitHub Pages 배포. **고정 URL 유지 필수**
- 정적 호스팅뿐. 서버 사이드 처리 없음

**이 제약 하에서의 결정:**
- ESM + `<script type="importmap">` + CDN(jsDelivr/unpkg) 유지. 번들러 도입은 마지막 수단
- 바이너리 에셋(.glb, .ktx2, .hdr)은 인라인 불가 → `assets/`에 별도 배치, standalone 빌드는 "코드만 인라인, 에셋은 상대경로" 모드로 수정
- GitHub Pages는 Brotli 자동 적용됨. 단, **에셋은 이미 압축 포맷이므로 재압축 기대하지 말 것**

---

## 2. 엔진 결정

**three.js 유지.** 단, 다음을 전제로 한다.

- three.js **r170+** 최신 고정 (버전 핀 필수, `latest` 금지)
- `WebGPURenderer` 우선 → 미지원 시 `WebGLRenderer` 자동 폴백. 두 경로 모두 실제로 동작해야 함
- 컬러 파이프라인: `outputColorSpace = SRGBColorSpace`, `toneMapping = AgXToneMapping`, 모든 albedo 텍스처 `SRGBColorSpace` / normal·roughness·metalness·AO는 `LinearSRGBColorSpace`

**Babylon.js 이주는 하지 않는다.** 이유: 기존 게임 로직 전면 재작성 비용이 화질 이득보다 크다.
단, 다음 두 경우엔 보고하고 재논의:
1. 캐릭터 애니메이션 블렌딩/IK가 three에서 감당 안 될 때
2. 피부 SSS가 three PBR로 납득할 품질이 안 나올 때

---

## 3. PHASE 1 — 렌더링 기반 공사 (에셋 없이 먼저)

에셋 교체 전에 **렌더링 파이프라인부터** 만든다. 순서 바꾸지 말 것.
(현재 로우폴리 에셋으로도 여기서 이미 체감 차이 크게 남)

### 3-1. IBL / 조명

- Poly Haven CC0 HDRI 도입 (실내 체육관/아레나 계열). 2K EXR → **KTX2 또는 RGBE PNG로 변환**해서 용량 1MB 이하로
- `PMREMGenerator`로 환경맵 프리필터 → `scene.environment`에 주입
- `scene.environmentIntensity` 노출값 튜닝
- 직접광: 키 라이트 1개(링 상단 스포트) + 필 2개. **그림자 캐스팅은 키 라이트만**
- 관중석 조명은 emissive 머티리얼 + bloom으로 처리. 실제 라이트 추가 금지 (드로우콜/셰이더 비용)

### 3-2. 그림자

- CSM(Cascaded Shadow Maps) 도입 — `three-csm` 또는 직접 구현
- 캐스케이드 3단, 2048px. 모바일은 2단 1024px
- 링 바닥 접지 그림자는 **contact shadow(실시간)** 또는 **베이크된 AO 데칼** 병행. 캐릭터 발밑 접지감이 실사감의 핵심

### 3-3. 포스트프로세싱

three.js 기본 `EffectComposer` **쓰지 말 것**. 아래로 교체:

```
pmndrs/postprocessing  ← 메인 컴포저
```

이펙트 스택 (렌더 순서 그대로):

| 순서 | 이펙트 | 라이브러리 | 비고 |
|---|---|---|---|
| 1 | SSGI 또는 SSAO | `realism-effects`(SSGI) / `n8ao`(AO) | 저사양은 N8AO만 |
| 2 | SSR (반사) | `realism-effects` | 링 바닥 젖은 표면용. 모바일 OFF |
| 3 | Motion Blur | `realism-effects` | 펀치 속도감. 강도 낮게 |
| 4 | Bloom | `postprocessing` (SelectiveBloom) | 조명/땀 하이라이트만. 전체 블룸 금지 |
| 5 | DOF | `postprocessing` | 카메라 컷 연출 시에만 동적 활성 |
| 6 | TRAA 또는 SMAA | `realism-effects`(TRAA) / `postprocessing`(SMAA) | SSGI/SSR 쓰면 TRAA 필수 (노이즈 제거) |
| 7 | LUT + Vignette + Film Grain + Chromatic Aberration | `postprocessing` | 아주 약하게. 과하면 싸구려 됨 |

- 전부 **품질 프리셋(low/medium/high/ultra)으로 묶어서** 런타임 토글 가능하게
- 기기 성능 자동 감지 → 초기 프리셋 결정. 사용자 수동 변경 UI 제공

### 3-4. 동적 해상도 (필수)

- 프레임타임 모니터링 → 목표 fps 미달 시 `renderer.setPixelRatio` 단계적 하향 (1.0 → 0.85 → 0.7 → 0.6)
- 여유 생기면 다시 상향. 히스테리시스 넣어서 진동 방지
- 이거 하나로 저사양 기기 대응이 거의 끝남

**PHASE 1 검증:** 기존 에셋 그대로, before/after 스크린샷 비교 + Chrome DevTools 성능 트레이스 첨부.

---

## 4. PHASE 2 — 실사급 에셋 제작

여기가 진짜 화질의 8할.

### 4-1. 캐릭터 (복서)

**제작 경로 (택1, 라이선스 반드시 확인):**
- Character Creator 4 + Headshot 플러그인 → 실사 인체 생성 → GLB 익스포트 (권장)
- Daz3D Genesis 9 + 상용 라이선스
- Blender + 무료 베이스메시(MB-Lab 등) + 수작업 (시간 많이 듦)
- 포토스캔 (본인 촬영 → RealityCapture/Meshroom)

**웹용 최적화 규격:**

| 항목 | 규격 |
|---|---|
| 하이폴리 | 제한 없음 (베이킹 소스용) |
| 게임메시 LOD0 | 40~60k tris |
| LOD1 | 15k tris (카메라 거리 중간) |
| LOD2 | 5k tris (원거리/관중) |
| 본 수 | 70개 이하 (얼굴 블렌드셰이프 별도) |
| 텍스처 | 얼굴 2K, 바디 2K, 장비 1K |

**머티리얼 (실사감 핵심):**
- 피부: `MeshPhysicalMaterial` + `sheen`(솜털/림라이트) + `thickness`/`transmission` 약하게(SSS 흉내) + 마이크로노멀(피부결) + 캐비티맵
- 땀/오일: `clearcoat` 0.3~0.6, `clearcoatRoughness` 낮게. 라운드 진행에 따라 동적으로 올리면 연출 좋음
- 글러브 가죽: 노멀맵 + roughness 변주 + 약한 sheen
- 근육 정의는 **노멀맵/AO로** 해결. 폴리곤 늘리지 말 것

**텍스처 채널 풀세트 필수:** albedo / normal / roughness / metalness / AO / (선택) cavity, thickness
로우폴리 + 단색 머티리얼이면 어떤 렌더러를 써도 플라스틱처럼 보인다.

### 4-2. 링 / 아레나

- 링 캔버스, 로프, 코너 패드, 링 바닥: ambientCG / Poly Haven **CC0 타일러블 PBR** 사용
- 아레나 구조물(정적): **Blender Cycles로 라이트맵 베이크** → 실시간 GI 비용 0으로 실내 간접광 획득. 이게 실사감 대비 성능 효율 최고
- 로프는 지오메트리 + 물리 흔들림. 빌보드 금지 (가까이서 티남)

### 4-3. 관중 (성능 함정 1순위)

세 가지 중 택. 관중을 풀 메시로 넣으면 프레임 죽는다.

1. **Gaussian Splat 배경** — 관중석 전체를 스플랫으로. `spark.js`(three 연동). 실사감 최고, 애니메이션 불가
2. **임포스터/빌보드** — 각도별 스프라이트 시트 + `InstancedMesh`. 수천 명 드로우콜 1회
3. **애니메이션 스프라이트 아틀라스** — 몇 종류 루프를 랜덤 오프셋으로. 가장 무난

관중석은 어차피 DOF로 날아가고 어둡다. 여기 폴리곤 쓰지 마라.

### 4-4. 모션

- Mixamo (무료) 복싱 모션 → 리타겟. 품질 한계 있음
- 실사급 원하면: 실제 촬영 → Move.ai / DeepMotion 같은 AI 모캡
- 타격 순간 **프레임 홀드(2~3프레임 정지)** + 카메라 셰이크 + 모션블러. 실사감보다 **타격감**이 체감 퀄을 더 올린다

### 4-5. 압축 파이프라인 (필수, 생략 금지)

`gltf-transform` CLI로 전부 처리:

```bash
# 지오메트리 압축
gltf-transform meshopt input.glb output.glb

# 텍스처 압축 (GPU에서 압축 상태로 유지 → VRAM 절약)
gltf-transform uastc output.glb output.glb --slots "{normalTexture,...}"   # 노멀맵: 고품질
gltf-transform etc1s output.glb output.glb --slots "{baseColorTexture,...}" # 알베도: 고압축

# 미사용 데이터 제거
gltf-transform prune output.glb final.glb
```

- 런타임: `KTX2Loader` + `MeshoptDecoder` 등록. **트랜스코딩은 워커에서** (메인스레드 블로킹 방지)
- PNG/JPG 직접 로드 금지. KTX2가 전송량뿐 아니라 VRAM도 4~8배 절약한다

---

## 5. PHASE 3 — 성능 최적화

- **인스턴싱**: 관중, 로프, 반복 구조물 전부 `InstancedMesh`
- **LOD**: `THREE.LOD`로 거리별 전환. 전환 지점 카메라 워크 기준으로 튜닝
- **프러스텀 컬링** 켜고, 큰 메시는 분할해서 컬링 효율 확보
- **머티리얼 통합**: 텍스처 아틀라스로 드로우콜 병합
- **셰이더 프리컴파일**: `renderer.compileAsync()` 로딩 화면에서 미리. 첫 펀치에 히칭 없애기
- **프로그레시브 로딩**: 저해상도 텍스처 먼저 → 고해상도 스왑. 로딩 화면 체감 단축
- **GC 압박 제거**: 렌더 루프 안에서 `new Vector3()` 등 할당 금지. 전부 재사용 객체로
- **오프스크린 캔버스** 검토 (WebGPU 경로에서)

---

## 6. 산출물

1. 수정된 `index.html` / `js/` — 품질 프리셋 토글 포함
2. `assets/` — KTX2/meshopt 처리 완료된 에셋
3. `build_standalone.py` 수정 — 에셋 외부 참조 모드
4. `PERF_REPORT.md` — before/after 스크린샷, FPS/프레임타임 트레이스, 전송량, 드로우콜 수치
5. 에셋 출처 + 라이선스 목록 (`ASSETS_LICENSE.md`) — CC0/상용 여부 명시

---

## 7. 작업 규칙

- **PHASE 단위로 커밋.** 한 번에 다 바꾸고 "됐습니다" 금지
- 각 PHASE 끝에 **실제 브라우저에서 측정한 수치**를 제시할 것. 추정치 금지
- 성능 목표 미달이면 다음 PHASE로 넘어가지 말고 그 자리에서 해결
- WebGL 폴백 경로를 실제로 테스트할 것 (WebGPU 끄고)
- 모바일 사파리에서 실제로 열어볼 것. 데스크톱만 보고 끝내지 말 것
- 라이선스 불명 에셋 사용 금지. GitHub Pages는 공개 배포다
