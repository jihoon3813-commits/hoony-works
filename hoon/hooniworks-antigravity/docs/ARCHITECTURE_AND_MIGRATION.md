# 현재 구조와 데이터 이전

## 1. 파일과 실행 순서

`dist/index.html`은 `app.js` → `enhancements.js` → `hooniworks.js` 순으로 일반 스크립트를 실행한다. 현재 전역 렉시컬 상태와 함수 재정의 방식으로 기능을 확장하므로, 순서를 바꾸거나 일부만 ES module로 전환하면 동작이 깨질 수 있다. 스타일도 `styles.css` 이후 `hooniworks.css`가 후니웍스 화면을 덮어쓴다.

| 파일 | 주요 책임 |
|---|---|
| app.js | 기본 상수·샘플, 캠페인·제작실 편집, 모달, 공통 이벤트 |
| enhancements.js | 템플릿 캔버스, 원본 업로드·복원, 채널 정보, 게시 준비·기록·파일 묶음 |
| hooniworks.js | 루트 저장 상태, 상품 추가·전환, 120 데이터 이전, 공통 대시보드·범용 콘텐츠 렌더링 |
| tests/workspaces.test.mjs | 실제 소스 함수를 VM에서 실행하며 데이터 이전과 분리를 검사; DOM 시각 검증은 별도 |

프레임워크로 옮길 경우 workspace store, campaign editor, asset repository, design renderer, provider adapter, publication service로 책임을 나누는 것을 권장한다. 기존 파일을 단순히 import하는 것만으로 전환 완료로 보지 않는다.

## 2. 현재 로컬 상태

저장 키: `hooniworks-workspaces-v1` / version: `1`

```text
root
  version
  activeId
  settings { budget, retries }
  workspaces[]
    id, createdAt
    brand { name, category, color, audience, description, tone, cta, links, accounts }
    catalog[]
    campaigns[]
    uploads[]
    templates[]
    posts[]
```

- `data`는 선택한 workspace 객체를 가리킨다. 상품 전환 시 catalog·필터·현재 캠페인·채널·미리보기 상태를 교체한다.
- `settings`의 예산·재생성 횟수는 공통 값이다. 현재 API 비용 제한을 실제 집행하지 않는다. workspace 안의 budget/retries는 기존 코드와의 호환값이다.
- `catalog`는 기본 제품·서비스 이미지 목록이다. 새 상품은 빈 catalog로 시작하고, 렌더링용 placeholder만 사용한다. placeholder는 실제 자료 개수에 포함하지 않는다.
- `uploads`는 파일 메타데이터와 작은 미리보기이며, 원본은 IndexedDB `120studio-assets`의 `originals` store에 업로드 ID를 키로 보관한다. 명칭에 120이 남아 있어도 기존 원본 호환성을 위한 저장소 이름이다.
- `templates`는 해당 상품의 사용자 템플릿이다. 기본 9개 레이아웃은 코드에서 제공하며 새 상품에는 일반 상품·서비스용 이름과 문구를 사용한다.
- `posts`는 게시 준비 또는 수동 게시 URL 기록이다. 외부 API 게시 결과가 아니다.
- 새 캠페인의 `designMode`는 `creative`; 다른 값은 `reference`, `template`이다. 기존 120 캠페인은 호환을 위해 `template`으로 이전한다.

## 3. 120 단독 버전에서 이전

후니웍스 저장 키가 없을 때 기존 `120studio-design-v1` 값을 읽어 `brand-120pie` 작업실로 옮긴다. 캠페인, 업로드 ID, 사용자 템플릿, 브랜드·채널 정보와 게시 기록을 유지한다. legacy 키는 백업으로 남기며 초기화하거나 삭제하지 않는다. 원본 IndexedDB의 업로드 ID도 유지한다.

새 형식 데이터가 이미 있으면 해당 값을 우선한다. 파싱할 수 없는 저장값은 덮어쓰지 않고 저장을 중단하는 안내를 표시한다. 서버 이전 시 이 원칙을 유지하고 버전별 마이그레이션을 추가한다.

새 상품은 별도의 ID를 사용하고 빈 캠페인·자료·사용자 템플릿·게시 기록으로 시작한다. 같은 이름 등록은 UI에서 거절한다. 서버 환경에서는 동일 이름 허용 정책과 별개로 ID가 유일성을 책임져야 한다.

## 4. 서버화할 때 지킬 경계

현재 브라우저 분리는 사용자 인증이나 서버 보안 경계가 아니다. 서버 모델은 다음 관계를 명시적으로 갖는다.

| 엔터티 | 소유 범위 |
|---|---|
| Account / User / Membership | 사용자의 계정과 접근 가능한 workspace |
| Workspace | 하나의 상품·브랜드 작업 공간 |
| ProductItem | workspace 내부의 상세 제품·메뉴·서비스 항목 |
| Asset / Campaign / Template / Content | workspaceId 필수; 공용 템플릿은 공유 범위를 별도로 명시 |
| GenerationJob / ChannelConnection / Publication | workspaceId 필수, 연결된 콘텐츠·계정도 같은 workspace인지 검사 |

현재 사용자가 ‘상품 추가’로 만드는 대상은 Workspace이다. 120pie의 애플파이·블루베리 같은 내부 메뉴와 혼동하지 않는다. 다른 상품의 자료를 쓰려면 명시적인 복사·공유 동작과 출처·접근 권한을 별도로 설계한다.

데이터베이스 요청·원본 파일 접근·내보내기·OAuth callback·작업 큐 처리 모두에서 workspaceId를 재검증한다. 프런트 선택값은 접근 권한 증거가 아니다. 출력 파일·생성 작업은 시작 시 workspace/campaign/content/channel 버전을 고정해, 사용자가 다른 상품으로 이동해도 대상이 바뀌지 않도록 한다.

## 5. 브라우저 자료를 서버로 가져오기

현재 구현되지 않은 후속 작업이다.

1. 현재 브라우저 자료의 상품·캠페인·사진 수를 보여준다.
2. 사용자가 가져올 상품과 서버의 연결 대상을 선택한다.
3. 원본 업로드와 메타데이터 이전에 중복 방지 키·해시를 사용한다.
4. 성공·누락·실패 목록을 제공한다. 원본이 없어 미리보기만 남았으면 구분해 표시한다.
5. 재시도 가능하게 만들고 기존 브라우저 데이터는 유지한다.

ZIP에는 사용자의 브라우저 데이터가 포함되어 있지 않다. 호스팅 사이트와 로컬 서버는 서로 다른 origin이며 자료가 자동 복사되지 않는다. 여러 기기·계정·동시 편집은 서버 구현 범위이다.

## 6. 현재 초기화 동작

현재 상품의 캠페인·업로드 목록·내 템플릿·게시 기록만 지우고, 브랜드·채널 설정·기본 catalog와 다른 상품은 유지한다. IndexedDB 원본은 삭제하지 않는다. 서버화할 때 보관 기간·휴지통·복구·참조되지 않은 파일 정리를 명시적으로 설계한다.
