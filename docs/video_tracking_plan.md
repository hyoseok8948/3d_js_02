# 동영상(Video) 연동 및 다중 인물 추적 구현 계획

이 문서는 기존 웹캠(Webcam) 기반의 실시간 모션 캡처 방식을 **미리 녹화된 동영상 파일(`tennis.mp4`)을 입력으로 사용**하고, 영상 내 **여러 인물 중 특정 인물만 추적하여 아바타에 적용**하도록 시스템을 변경하기 위한 구현 계획입니다.

## 1. 개요 (Overview)

현재 `App.tsx`는 브라우저의 웹캠(`getUserMedia`)을 사용하여 실시간으로 한 명의 포즈를 추적하고 있습니다. 이를 변경하여 로컬 동영상 파일을 재생하고, 프레임마다 MediaPipe를 구동시켜 다수의 인물 중 원하는 인물의 데이터만 `Skeleton3D` 컴포넌트로 전달하는 것이 목표입니다.

## 2. 주요 구현 단계 (Implementation Steps)

### Step 1: 비디오 소스 교체 (Input Source Replacement)
*   **AS-IS**: `navigator.mediaDevices.getUserMedia`를 호출하여 웹캠 스트림을 `<video>` 태그에 연결
*   **TO-BE**: 웹캠 호출 로직을 제거하고, `<video>` 태그의 `src` 속성에 `assets/video/tennis.mp4` 경로를 직접 연결합니다.
*   **동기화 보장**: 비디오의 `onloadeddata` 또는 `onplay` 이벤트를 감지한 후부터 AI 추적 루프(`detectPose`)가 돌도록 로직을 수정합니다.

### Step 2: MediaPipe 다중 인물 인식 설정 (Enable Multi-Pose)
*   `PoseLandmarker.createFromOptions` 설정에서 `numPoses` 값을 수정합니다.
*   **AS-IS**: `numPoses: 1` (화면에서 1명만 인식)
*   **TO-BE**: `numPoses: 5` (예: 최대 5명까지 동시 인식)
*   이렇게 설정하면 MediaPipe의 결과값인 `result.landmarks` 배열에 인식된 여러 사람의 뼈대 데이터 묶음이 함께 반환됩니다.

### Step 3: 특정 인물 타겟팅 및 필터링 로직 추가 (Target Tracking Logic)
화면에 여러 명의 뼈대 데이터가 추출되었을 때, "어떤 사람을 3D 아바타에 적용할 것인가?"를 결정하는 로직이 필요합니다.

1.  **상태 관리 추가**: 컴포넌트 내에 추적할 대상의 고유 인덱스나 조건을 저장하는 State 추가 (예: `const [targetPersonIndex, setTargetPersonIndex] = useState(0);`)
2.  **데이터 선별 작업**: `detectPose` 루프 내에서 무조건 첫 번째 사람(`result.landmarks[0]`)을 가져오는 것이 아니라, 설정된 조건에 맞는 사람을 선별합니다.
    *   *단순 방법 (인덱스 지정)*: 화면에서 MediaPipe가 넘겨주는 순서(보통 화면 내 크기나 먼저 발견된 순)를 인덱스로 삼아 고정적으로 한 명만 추출 ( `setLandmarks(normalizeLandmarks(result.landmarks[targetPersonIndex]));` )
    *   *정교한 방법 (화면 중심 추적)*: 여러 사람의 골반(Hips) 좌표의 평균을 내어, 화면 정중앙(x=0.5 부근)에 가장 일관되게 위치한 사람(메인 피사체)을 매 프레임 찾아내어 그 사람의 데이터만 전달

### Step 4: UI/UX 컨트롤 추가 (User Interface)
사용자가 비디오를 제어하고 추적 대상을 변경할 수 있는 간단한 UI를 추가합니다.
*   비디오 재생/일시정지 버튼
*   추적 대상 변경 버튼 (예: "다음 사람 추적", "중앙 인물 추적" 등)

---

## 3. 기대 효과 (Expected Behavior)
*   `tennis.mp4` 영상이 재생되면서, 테니스 코트 내 여러 명의 선수가 있더라도 사용자가 지정한(혹은 로직이 판단한) 특정 선수 한 명의 움직임만 3D 아바타가 완벽하게 따라 하게 됩니다.
*   기존의 `Skeleton3D.tsx` 엔진은 데이터가 한 명의 33개 랜드마크 배열로 똑같이 들어오기 때문에 **전혀 수정할 필요가 없습니다.** 오직 데이터를 넘겨주는 `App.tsx`의 "추출 및 필터링" 파트만 변경됩니다.
