# 3D 아바타 모션 데이터 처리 파이프라인 (Pose Data Flow)

이 문서는 사용자의 동작 수치(랜드마크 데이터)가 3D 아바타(`Skeleton3D` 컴포넌트)의 실제 움직임으로 변환되고 적용되는 과정을 설명합니다.

## 1. 입력 데이터 구조 (Input Data)

외부(예: MediaPipe)로부터 포즈 측정 수치가 `Skeleton3D` 컴포넌트의 `landmarks` 프로퍼티(배열 형식)로 전달됩니다.

```typescript
// 단일 관절점(Landmark)의 데이터 구조
interface Landmark {
  x: number; // 3D 공간상의 x 좌표 (또는 정규화된 2D 좌표)
  y: number; // 3D 공간상의 y 좌표 (또는 정규화된 2D 좌표)
  z: number; // 깊이(Depth) 값
}

// 전체 입력 데이터 배열 (MediaPipe Pose 모델 기준 33개의 요소를 가짐)
type PoseData = Landmark[];
```

- 배열의 **인덱스(Index)**는 인체의 특정 관절 위치를 의미합니다. (예: `11`=왼쪽 어깨, `13`=왼쪽 팔꿈치, `23`=왼쪽 골반 등)
- 입력되는 수치는 Float 형태의 좌표값입니다.

---

## 2. 데이터 가공 및 변환 (Data Processing)

들어온 원본 숫자 데이터는 내부의 `getLm` 함수를 통해 Three.js의 3D 월드 환경에 맞게 변환됩니다.

```typescript
const getLm = (i: number, out: THREE.Vector3) => {
  const lm = landmarks?.[i];
  
  // 1) 스케일링 (Scale): 웹캠이나 모델의 원본 스케일을 3D 월드 상의 아바타 크기(landmarkScale)에 맞게 증폭시킵니다.
  out.set(lm.x * landmarkScale, lm.y * landmarkScale, lm.z * landmarkScale);

  // 2) 미러링 처리 (Mirroring): 거울 모드로 설정된 경우, 움직임이 반대가 되도록 X축의 값을 반전(* -1)시킵니다.
  if (mirrored) out.x *= -1;
  
  return true;
};
```

---

## 3. 관절 방향 벡터 계산 (Direction Vector Extraction)

Three.js에서 모델을 움직이기 위해서는 절대적인 '위치 좌표'를 그대로 대입하는 것이 아니라, 부모 뼈대에서 자식 뼈대로 향하는 **방향 벡터(Direction Vector)**를 추출해야 합니다. 매 프레임(`useFrame`)마다 각 뼈대의 시작점과 끝점을 이용해 방향을 구합니다.

**예시: 사용자 왼쪽 위팔(어깨 -> 팔꿈치)의 방향 계산**
```typescript
// 1) 어깨와 팔꿈치의 위치 좌표를 벡터로 가져옴
const lShoulder = new THREE.Vector3(...); // 11번 (왼쪽 어깨)
const lElbow = new THREE.Vector3(...);    // 13번 (왼쪽 팔꿈치)

// 2) 팔꿈치 위치에서 어깨 위치를 빼서 뼈대가 뻗어가는(향하는) 방향을 구하고, 길이를 1로 정규화(Normalize)
const dir = new THREE.Vector3().subVectors(lElbow, lShoulder).normalize();
```

---

## 4. 3D 아바타 뼈대에 적용 (Rigging & Rotation)

추출된 목표 방향 벡터(`dir`)는 `aimBone` 함수에 전달되어 아바타의 특정 뼈대(Bone)를 회전시키는 데 사용됩니다.

1. **로컬 좌표계 적응**: 월드 기준의 방향(`dirWorld`)을 관절 부모 그룹 기준의 로컬 좌표(`dirLocal`)로 변경합니다.
2. **회전값 계산(Quaternion)**: 아바타 뼈대의 원래 기본 축(`restAxis`)이 목표 방향(`dirLocal`)을 바라볼 수 있도록, 필요한 회전량(Quaternion `tmpQ3`)을 만들어냅니다.
3. **부드러운 움직임 보간 (Slerp)**: 뼈대가 즉시 목표 방향으로 꺾여서 끊겨 보이는(Jitter) 현상을 없애기 위해, 감쇠 계수(`alpha`)를 적용하여 뼈대가 현재 위치에서 목표 위치를 향해 부드럽게 보간(`slerp`)되며 따라오도록 합니다.

```typescript
// 계산된 방향 수치를 3D 모델의 실제 뼈대(예: 오른팔) 회전에 부드럽게 적용함
aimBone("mixamorigRightArm", dir, alpha);
```

> **💡 매핑 참고 사항:**
> 사용자의 왼쪽 팔 움직임은 아바타의 오른쪽 팔(`mixamorigRightArm`)을 움직이도록 크로스(Cross)로 매핑되어 있습니다. 거울 모드(`mirrored`) 설정과 함께 연동되어 사용자가 마치 거울을 보며 3D 아바타를 조종하는 듯한 자연스러운 피드백을 제공합니다.
