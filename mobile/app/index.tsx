import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';

export default function StartScreen() {
  const handlePrepare = () => {
    router.push('/waiting');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Kit</Text>
      <Pressable style={styles.button} onPress={handlePrepare}>
        <Text style={styles.buttonText}>발표 준비</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 48,
  },
  button: {
    backgroundColor: '#4F46E5',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});