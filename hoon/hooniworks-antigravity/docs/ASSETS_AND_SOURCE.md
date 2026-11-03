# 이미지 및 소스 기준

기준 사이트: https://pie-content-studio.hoony365.chatgpt.site
배포 버전: 3 / 2026-11-03
원본 커밋: 8a03258839929a857dbdedf9cbd24d951f074c13

`dist/`는 위 커밋의 배포 소스와 동일하다. 작업 공간 회귀 테스트도 같은 커밋에서 가져왔다. 개발 전달용 문서·실행 도우미만 추가했다. 기존 Sites 배포 식별자와 Git 설정은 새 배포 환경에 잘못 적용되지 않도록 제외했다.

| 파일 | 구분 | 사용 원칙 |
|---|---|---|
| dist/assets/apple.webp | 실제 애플파이 제품 누끼 | 제품 모양·필링 보존 |
| dist/assets/pepperoni.webp | 실제 페페로니 피자파이 제품 누끼 | 제품 모양·필링 보존 |
| dist/assets/blueberry.webp | 실제 블루베리파이 제품 누끼 | 제품 모양·필링 보존 |
| dist/assets/lifestyle.webp | 생성한 애플파이·라떼 연출 이미지 | 분위기 참고, 실제 매장·고객 경험 증빙으로 쓰지 않음 |

포함된 사진은 앞선 화면 제작에 사용한 웹용 변환본이다. 촬영 원본 고해상도 파일 전체나 사용자가 브라우저에 새로 업로드한 자료는 이 패키지에 포함되지 않는다. 독립적인 공식 로고 이미지 파일은 포함하지 않았다. 후니웍스의 hw 심볼·워드마크는 HTML/CSS, 파비콘은 SVG 데이터로 구현되어 있다. 120pie는 기존 텍스트 브랜딩을 사용한다. 실제 운영 시 승인된 로고 파일을 별도로 등록한다.

## 개발 시 다시 확인할 공식 문서

아래는 기존 시안 설계에서 참고한 문서 주소다. 연동 전에 최신 지원 기능·권한·규격을 확인한다.

- OpenAI: https://developers.openai.com/
- Google AI: https://ai.google.dev/gemini-api/docs
- Meta 공식 Instagram 컬렉션: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
- YouTube 업로드: https://developers.google.com/youtube/data/reference/rest/v3/videos/insert
- 네이버 블로그 글쓰기 API 종료: https://developers.naver.com/notice/article/7527
- 카카오톡 채널 API: https://developers.kakao.com/docs/ko/kakaotalk-channel/common

이 이미지들은 120pie 상품 워크스페이스에만 기본 등록된다. 새 상품에는 자동으로 복제되지 않는다. 서비스·멤버십 등 다른 상품에는 해당 상품의 실제 자료를 별도로 등록해야 한다.
