// mobile/lib/alertQueue.ts
// RN의 Alert.alert는 한 번에 하나만 화면에 띄울 수 있는데, 이미 하나가 떠 있는 상태에서
// 또 Alert.alert를 호출하면(iOS 기준) 새 요청이 "큐잉"되지 않고 그냥 무시/드롭되는 경우가 있다.
// 그래서 노트 수정 알림처럼 여러 개가 짧은 시간 안에 연달아 발생할 수 있는 경우, 앱 전역에서
// 이 큐를 통해서만 Alert를 띄우게 하면 하나도 유실되지 않고 순서대로(사용자가 확인을 누를 때마다
// 다음 게 뜨는 식으로) 전부 보여줄 수 있다.
import { Alert } from 'react-native';

type QueuedAlert = { title: string; message: string };

const queue: QueuedAlert[] = [];
let showing = false;

function showNext() {
  const next = queue.shift();
  if (!next) {
    showing = false;
    return;
  }
  showing = true;
  Alert.alert(next.title, next.message, [{ text: '확인', onPress: showNext }], { cancelable: false });
}

export function enqueueAlert(title: string, message: string) {
  queue.push({ title, message });
  if (!showing) showNext();
}
