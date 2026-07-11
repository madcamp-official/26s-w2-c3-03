// mobile/app/waiting.tsx
import { View, Text, StyleSheet } from 'react-native';

export default function WaitingScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.codeRow}>
        <Text style={styles.codeLabel}>청중 코드</Text>
        <Text style={styles.codeValue}>A1B2C3</Text>
      </View>

      <View style={styles.codeRow}>
        <Text style={styles.codeLabel}>발표자 코드</Text>
        <Text style={styles.codeValue}>P9X7Q2</Text>
      </View>

      <Text style={styles.hint}>청중은 PC 화면의 QR로 입장하고, 다른 발표자는 위 발표자 코드를 앱에 입력하면 됩니다</Text>

      <Text style={styles.sectionTitle}>청중: 0명 입장</Text>

      <Text style={styles.sectionTitle}>발표 시간 설정</Text>
      <Text style={styles.placeholder}>(스크롤 타이머 자리 - 다음 단계에서 추가)</Text>

      <Text style={styles.sectionTitle}>발표자</Text>
      <Text style={styles.placeholder}>(발표자 목록 자리 - 다음 단계에서 추가)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
    padding: 24,
    paddingTop: 60,
  },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  codeLabel: {
    color: '#888',
    fontSize: 14,
  },
  codeValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  hint: {
    color: '#666',
    fontSize: 12,
    marginTop: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 24,
    marginBottom: 8,
  },
  placeholder: {
    color: '#666',
  },
});