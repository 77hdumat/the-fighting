# 음성 파일 넣는 법

1. 이 폴더에 mp3/ogg/wav 파일을 넣는다.
2. `manifest.example.json` 을 복사해 `manifest.json` 으로 저장하고 파일명을 맞춘다.
   - 값이 배열이면 랜덤 재생.
   - `캐릭터키:이벤트` (예: `mashiba:grunt`) 로 캐릭터별 분리. 캐릭터키: `ippo`, `mashiba`, `miyata`, `takamura`.
   - 없는 키는 자동으로 TTS/합성음으로 대체.
3. 새로고침. 게임 중 `V` 키로 FILE → TTS → OFF 전환.

이벤트 키: dempsey_start, faster, notyet, go, finisher, finisher_hit, counter, down, fight, crush, guardbreak, effective, noeffect, grunt(펀치 기합), hurt(피격)

※ 원작 애니메이션 음성은 저작권 자료입니다. 개인 사용 범위에서만 쓰고 배포본에 포함하지 마세요.
