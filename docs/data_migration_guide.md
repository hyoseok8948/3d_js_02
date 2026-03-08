# 데이터 구조 비교 및 마이그레이션 가이드 (Pose Data Migration)

이 문서는 기존의 랜드마크 기반 데이터 구조(`pose_data_flow.md`)와 새로운 애니메이션 데이터 구조(`serve_threejs_data.json`)를 비교하고, 새로운 구조를 적용하기 위해 프로젝트(`Skeleton3D.tsx`)에서 수정되어야 할 사항들을 정리합니다.

## 1. 데이터 구조 비교 (Comparison)

| 항목 | 기존 방식 (`pose_data_flow.md`) | 새로운 방식 (`serve_threejs_data.json`) |
| :--- | :--- | :--- |
| **데이터 형태** | 단순한 `x, y, z` 좌표들의 평면적 배열 (Array) | 계층화된 JSON 객체 (프레임별, 플레이어별 관절 데이터) |
| **식별 방식** | 정수 인덱스 (예: `11` = 왼쪽 어깨) | 명시적인 관절 이름 텍스트 (예: `"RightShoulder"`) |
| **제공 정보** | 위치(Position) 정보만 제공 | **위치(Position)와 회전(Rotation/Quaternion)** 모두 제공 |
| **좌표계 유형** | 정규화된 좌표 또는 단일 월드 좌표 | 로컬(Local) 및 월드(World) 좌표를 별도로 제공 |
| **에니메이션 데이터** | 실시간 스트리밍 위주 (현재 프레임만 존재) | 전체 타임라인, 프레임, 페이즈(Phase) 분석 정보 포함 |

---

## 2. 주요 차이점 및 문제점

기존 `Skeleton3D.tsx` 컴포넌트는 오직 **위치 데이터(점)**만 들어온다고 가정하고 작성되었습니다.
따라서 기존 로직에서는 *'어깨 점'*과 *'팔꿈치 점'*을 이어 **방향 벡터(Direction Vector)**를 직접 계산하고 뼈대를 회전시키는 복잡한 연산(`aimBone`)을 매 프레임마다 수행했습니다.

하지만 새로운 `serve_threejs_data.json` 데이터에는 **이미 각 뼈대(Joint)가 어떻게 회전해야 하는지에 대한 정답(Quaternion)이 포함되어 있습니다.** (`rotation_local`, `rotation_world` 항목)
즉, 더 이상 위치를 가지고 방향을 계산할 필요 없이 관절의 회전값을 뼈대에 직접 대입하기만 하면 됩니다.

---

## 3. `Skeleton3D.tsx` 수정 필요 사항 (Action Items)

새로운 JSON 데이터를 아바타에 적용하려면 아래와 같은 단계적인 로직 수정이 필요합니다.

### 🔴 AS-IS (현재 로직 파기)
* `getLm` 함수 제거: 배열 인덱스로 좌표를 가져오고 X축을 마이너스 처리하던 로직 제거
* `aimBone` 함수 및 위치 기반 각도 계산 제거: `subVectors().normalize()` 등 복잡한 벡터 방향 추론 연산 전부 폐기

### 🟢 TO-BE (새로운 로직 구현)

#### Step 1. 입력 데이터 인터페이스(Type/Props) 변경
컴포넌트가 받는 Props가 기존 `Landmark[]` 배열에서, 단일 프레임의 `joints` 객체를 받도록 수정해야 합니다.

```typescript
// 변경된 데이터 입력 예시
interface FrameJointData {
  position_local: [number, number, number];
  rotation_local: [number, number, number, number]; // [x, y, z, w]
  // ... 기타 속성들
}

interface Skeleton3DProps {
  // 기존: landmarks: Landmark[]
  frameData: Record<string, FrameJointData>; // ex) { "RightShoulder": {...}, ... }
}
```

#### Step 2. Bone 이름 매핑 (Name Mapping)
Mixamo 아바타 뼈대 이름(ex. `mixamorigRightArm`)과 JSON에 정의된 뼈대 이름(ex. `"RightShoulder"`)을 서로 연결해 주는 매핑 테이블(Dictionary)을 만들어야 합니다.

```typescript
// JSON 관절명 -> 모델 Bone 이름 매핑 예시
const jointMap: Record<string, string> = {
  "Hips": "mixamorigHips",
  "Spine": "mixamorigSpine",
  "RightShoulder": "mixamorigRightArm", // *어깨 회전값이 Arm(위팔) 뼈대에 해당
  "RightElbow": "mixamorigRightForeArm",
  // ... 나머지 관절 추가
};
```

#### Step 3. 회전값(Quaternion) 직접 적용 
`useFrame` 내부에서 각 관절의 데이터를 순회하며, 제공된 **로컬 회전값(`rotation_local`)**을 아바타의 해당 뼈대에 바로 덮어씌웁니다.

```typescript
useFrame(() => {
  if (!frameData) return;
  
  Object.keys(jointMap).forEach(jointName => {
    const data = frameData[jointName];
    const bone = getBone(jointMap[jointName]);
    
    if (data && bone) {
      // JSON의 [x, y, z, w] 쿼터니언 배열을 Bone의 quaternion에 직접 할당
      bone.quaternion.set(
        data.rotation_local[0],
        data.rotation_local[1],
        data.rotation_local[2],
        data.rotation_local[3]
      );
    }
  });
});
```

> **💡 핵심 요약**: 새로운 데이터를 사용하면, 복잡한 삼각함수나 벡터 연산을 버리고 미리 제공된 회전값(Quaternion)을 단순 대입하는 방식으로 코드가 훨씬 가벼워지고 움직임이 정확해집니다.
