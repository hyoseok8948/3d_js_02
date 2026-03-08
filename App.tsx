import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, Platform, TouchableOpacity } from 'react-native';
import { Canvas } from '@react-three/fiber';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import Skeleton3D from './Skeleton3D';

interface Landmark {
  x: number;
  y: number;
  z: number;
}

// 뒷모습 추적 시 해부학적 좌우 일치를 위한 데이터 반전 함수
const swapLeftRight = (landmarks: any[]) => {
  if (!landmarks || landmarks.length < 33) return landmarks;
  const newLms = [...landmarks];
  
  // MediaPipe 좌/우 인덱스를 서로 맞바춥니다.
  const swap = (i: number, j: number) => {
    const temp = newLms[i];
    newLms[i] = newLms[j];
    newLms[j] = temp;
  };

  // 얼굴
  swap(1, 4); swap(2, 5); swap(3, 6); // 눈
  swap(7, 8); // 귀
  swap(9, 10); // 입
  
  // 상체
  swap(11, 12); // 어깨
  swap(13, 14); // 팔꿈치
  swap(15, 16); // 손목
  swap(17, 18); // 새끼손가락
  swap(19, 20); // 집게손가락
  swap(21, 22); // 엄지손가락

  // 하체
  swap(23, 24); // 골반
  swap(25, 26); // 무릎
  swap(27, 28); // 발목
  swap(29, 30); // 뒷꿈치
  swap(31, 32); // 발끝

  return newLms;
};

const normalizeLandmarks = (landmarks: any[]): Landmark[] => {
  if (!landmarks || landmarks.length === 0) return [];
  
  return landmarks.map((mark) => {
    // 웹캠(MediaPipe) 좌표계 (0~1) -> R3F 3D 공간 좌표계 (-2~2 부근) 로 변환
    // y축은 MediaPipe가 위에서부터 0이므로 반전시킵니다.
    // 뒷모습 추적 + 해부학적 교환(Swap)을 사용할 때는 Z축(깊이)도 반전시켜 주어야
    // 무릎이나 팔꿈치가 올바른 방향(뒤쪽)으로 꺾이게 됩니다.
    return {
      x: (mark.x - 0.5) * -4,
      y: (mark.y - 0.5) * -4,
      z: mark.z * 2, // z 깊이값 크기 보정 (거울 모드가 아닐 경우 양수 곱셈으로 반전 효과)
    };
  });
};

export default function App() {
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const requestRef = useRef<number>(0);
  const isWeb = Platform.OS === 'web';
  const [modelStatus, setModelStatus] = useState<string>('AI 모델 로딩 중...');

  // 추가: 다중 인물 추적용 상태 관리
  const [targetPersonIndex, setTargetPersonIndex] = useState<number>(0);
  const targetPersonIndexRef = useRef<number>(0); // requestAnimationFrame 루프 내에서 최신 값을 참조하기 위해 사용
  const [detectedPosesCount, setDetectedPosesCount] = useState<number>(0);

  // 추가: 데이터 레코딩용 상태 관리
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const isRecordingRef = useRef<boolean>(false);
  const recordedDataRef = useRef<any[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const [recordProgress, setRecordProgress] = useState<string>('');

  // 1. MediaPipe AI 모델 초기화
  useEffect(() => {
    const initPoseLandmarker = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU" // 웹 환경에서 WebGL/GPU 가속 사용
          },
          runningMode: "VIDEO",
          numPoses: 1, // yellow.mp4는 한 명만 나오므로 1로 변경
        });
        
        poseLandmarkerRef.current = landmarker;
        setModelStatus('AI 로딩 완료, 동영상 대기 중...');
        // startWebcam(); // 기존 웹캠 시작 부분 제거
      } catch (error) {
        console.error("MediaPipe 초기화 오류:", error);
        setModelStatus('AI 모델 로딩 실패');
      }
    };

    if (isWeb) initPoseLandmarker();

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (poseLandmarkerRef.current) poseLandmarkerRef.current.close();
    };
  }, [isWeb]);

  // 2. 비디오 준비 완료 시 추적 시작 함수 (웹캠 대체)
  const isTrackingStarted = useRef<boolean>(false);
  const handleVideoLoaded = () => {
    videoRef.current?.play();
    setModelStatus('모션 추적 시작 (동영상)');
    
    // 루프가 중복 실행되지 않도록 방어 코드
    if (!isTrackingStarted.current) {
      isTrackingStarted.current = true;
      detectPose();
    }
  };

  // 3. 매 프레임별 AI 추적 루프
  const detectPose = () => {
    if (!videoRef.current || !poseLandmarkerRef.current || videoRef.current.readyState < 2) {
      requestRef.current = requestAnimationFrame(detectPose);
      return;
    }

    const startTimeMs = performance.now();
    let result: any = null;
    
    // 비디오 현재 프레임을 던져서 결과 받기 (동영상 루프 시 예외 처리 포함)
    try {
      result = poseLandmarkerRef.current.detectForVideo(videoRef.current, startTimeMs);
    } catch (e) {
      console.warn("Video frame jump error (likely loop refresh)", e);
    }

    if (result && result.landmarks && result.landmarks.length > 0) {
      const posesCount = result.landmarks.length;
      setDetectedPosesCount(posesCount);

      const validIndex = 0; // 한 명만 추적하므로 첫번째 데이터 고정
      
      // 변환된 좌표를 State에 업데이트 -> Skeleton3D로 전달됨
      // + 뒷모습이므로 swapLeftRight 함수를 거쳐 좌우 관절 데이터를 바꿉니다
      const swappedLandmarks = swapLeftRight(result.landmarks[validIndex]);
      const normalizedLandmarks = normalizeLandmarks(swappedLandmarks);
      setLandmarks(normalizedLandmarks);

      // 데이터 기록 중이라면 배열에 추가 (현재 시간과 함께)
      if (isRecordingRef.current) {
        const elapsedTime = (performance.now() - recordingStartTimeRef.current) / 1000;
        
        // 15초가 경과하면 자동 종료 및 다운로드
        if (elapsedTime >= 15) {
          stopRecordingAndDownload();
        } else {
          // 진행 시간 UI용 상태 업데이트 (약간의 쓰로틀링 효과를 위해 소수점 버림)
          setRecordProgress(`${elapsedTime.toFixed(1)}초 / 15.0초`);
          
          recordedDataRef.current.push({
            time_sec: Number(elapsedTime.toFixed(3)),
            landmarks: normalizedLandmarks
          });
        }
      }

    } else {
      setDetectedPosesCount(0);
    }

    // 다음 브라우저 프레임에 다시 예약
    requestRef.current = requestAnimationFrame(detectPose);
  };

  // 4. 레코딩 제어 함수
  const startRecording = () => {
    if (isRecording) return;
    recordedDataRef.current = [];
    recordingStartTimeRef.current = performance.now();
    isRecordingRef.current = true;
    setIsRecording(true);
    setRecordProgress('0.0초 / 15.0초');
    
    // 영상도 처음부터 다시 맞추려면 주석 해제 (옵션)
    // if (videoRef.current) videoRef.current.currentTime = 0;
  };

  const stopRecordingAndDownload = () => {
    isRecordingRef.current = false;
    setIsRecording(false);
    setRecordProgress('기록 완료!');

    // JSON 데이터 생성 및 브라우저 다운로드 트리거
    const dataStr = JSON.stringify(recordedDataRef.current, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pose_tracking_15sec.json';
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <View style={styles.container}>
      {/* 1. 웹캠 영상 렌더링 (웹에서만 동작) */}
      {isWeb ? (
        <View style={StyleSheet.absoluteFill}>
          <video
            ref={videoRef}
            src={require('./assets/video/yellow.mp4')} // yellow.mp4로 교체
            playsInline
            muted
            loop
            onLoadedData={handleVideoLoaded}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              // transform: 'scaleX(-1)' // 거울 반전 제거 (사전 녹화 영상)
            }}
          />
        </View>
      ) : (
        <View style={styles.center}>
          <Text style={styles.text}>현재 코드는 웹 브라우저용입니다.</Text>
        </View>
      )}

      {/* 2. 3D Canvas 오버레이 (배경 투명) */}
      <View style={styles.canvasContainer} pointerEvents="none">
        <Canvas camera={{ position: [0, 0, 5], fov: 60 }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 10]} intensity={1.5} />
          
          {/* 실시간 추출된 랜드마크 기반 3D 스켈레톤 렌더링 */}
          <Skeleton3D landmarks={landmarks} />
        </Canvas>
      </View>

      {/* 3. 테스트용 UI 오버레이 */}
      <View style={styles.uiContainer} pointerEvents="box-none">
        <Text style={styles.uiText}>3D Video Tracking</Text>
        <Text style={styles.uiSubText}>상태: {modelStatus}</Text>
        <Text style={styles.uiSubText}>인식된 사람 수: {detectedPosesCount}</Text>

        <View style={styles.controls}>
          <Text style={styles.uiSubText}>추적 대상 선택: P{targetPersonIndex + 1}</Text>
          <View style={styles.buttons}>
            {[0, 1, 2, 3, 4].map((index) => (
              <TouchableOpacity 
                key={index} 
                style={[styles.button, targetPersonIndex === index && styles.activeButton]}
                onPress={() => {
                  setTargetPersonIndex(index);
                  targetPersonIndexRef.current = index; // 루프용 Ref 업데이트
                }}
              >
                <Text style={[styles.buttonText, targetPersonIndex === index && styles.activeButtonText]}>
                  P{index + 1}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={[styles.controls, { marginTop: 10 }]}>
          <Text style={styles.uiSubText}>움직임 데이터 추출 (15초)</Text>
          <TouchableOpacity 
            style={[styles.button, { marginTop: 5, backgroundColor: isRecording ? '#ff4444' : '#00ffff' }]}
            onPress={isRecording ? stopRecordingAndDownload : startRecording}
          >
            <Text style={[styles.activeButtonText, { color: isRecording ? 'white' : 'black' }]}>
              {isRecording ? '정지 및 저장 (진행중)' : '15초 데이터 기록 시작'}
            </Text>
          </TouchableOpacity>
          {isRecording && <Text style={{ color: '#ff4444', marginTop: 5 }}>{recordProgress}</Text>}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  text: { color: 'white', fontSize: 18 },
  canvasContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    backgroundColor: 'transparent',
  },
  uiContainer: { position: 'absolute', top: 20, left: 20, zIndex: 20 },
  uiText: { color: '#00ffff', fontSize: 24, fontWeight: 'bold' },
  uiSubText: { color: 'white', fontSize: 14, marginTop: 4 },
  controls: { 
    marginTop: 15, 
    backgroundColor: 'rgba(0,0,0,0.5)', 
    padding: 10, 
    borderRadius: 8 
  },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 10 },
  button: { 
    backgroundColor: '#333', 
    paddingVertical: 6, 
    paddingHorizontal: 12, 
    borderRadius: 4, 
    minWidth: 40,
    alignItems: 'center'
  },
  activeButton: { backgroundColor: '#00ffff' },
  buttonText: { color: 'white', fontWeight: '500' },
  activeButtonText: { color: 'black', fontWeight: 'bold' }
});
