// mobile/app/note-editor.tsx
import { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SERVER_URL } from '../lib/socket';
import { useKitStore } from '../store/useKitStore';
import { colors, radius } from '../constants/theme';

export default function NoteEditorScreen() {
  const roomId = useKitStore((s) => s.roomId);
  const slideCount = useKitStore((s) => s.slideCount);
  const slideNotes = useKitStore((s) => s.slideNotes);
  const currentIndex = useKitStore((s) => s.currentNoteSlideIndex);
  const imageUrl = useKitStore((s) => s.slideImages[s.currentNoteSlideIndex]);

  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [imageFailed, setImageFailed] = useState(false);

  // [수정] 원래는 슬라이드를 넘기면(goToSlide) 저장 안 한 수정 내용이 그냥 사라졌음(다음 슬라이드로
  // 넘어가면서 store의 slideNotes 값으로 text가 덮어써짐). 이제는 슬라이드별로 "아직 저장 안 한
  // 수정 내용"을 여기 drafts에 들고 있다가, "저장" 버튼 한 번으로 한꺼번에 서버에 반영한다.
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  useEffect(() => {
    setImageFailed(false);
  }, [currentIndex]);

  useEffect(() => {
    const existing = slideNotes.find((n) => n.slideIndex === currentIndex);
    // 이 슬라이드에 저장 안 한 초안이 있으면 그걸 먼저 보여줌 (없으면 서버에 저장된 노트)
    setText(drafts[currentIndex] ?? existing?.text ?? '');
    setStatusText('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  const handleChangeText = (val: string) => {
    setText(val);
    const existing = slideNotes.find((n) => n.slideIndex === currentIndex);
    setDrafts((prev) => {
      const next = { ...prev };
      // 원래 저장된 내용과 완전히 같아지면 "수정됨" 표시에서 빼줌
      if (val === (existing?.text ?? '')) {
        delete next[currentIndex];
      } else {
        next[currentIndex] = val;
      }
      return next;
    });
  };

  const goToSlide = (delta: number) => {
    const next = Math.min(slideCount, Math.max(1, currentIndex + delta));
    useKitStore.setState({ currentNoteSlideIndex: next });
  };

  const editedIndexes = Object.keys(drafts).map(Number).sort((a, b) => a - b);
  const editedCount = editedIndexes.length;

  const handleBack = () => {
    if (editedCount === 0) {
      router.back();
      return;
    }
    Alert.alert(
      '저장하지 않은 내용이 있어요',
      `슬라이드 ${editedIndexes.join(', ')}에 저장하지 않은 수정 내용이 있어요. 저장하지 않고 나갈까요?`,
      [
        { text: '계속 편집', style: 'cancel' },
        { text: '저장 안 하고 나가기', style: 'destructive', onPress: () => router.back() },
      ]
    );
  };

  const handleSaveAll = async () => {
    if (editedCount === 0) {
      setStatusText('변경된 내용이 없어요');
      return;
    }
    setSaving(true);
    try {
      const myName = useKitStore.getState().nickname || '발표자';
      // 슬라이드마다 별도 REST 엔드포인트라서, 수정된 슬라이드 수만큼 PUT을 동시에 보내고 전부
      // 끝나길 기다린다 (한 번의 "저장" 버튼 클릭 = 여러 슬라이드 한꺼번에 반영).
      const results = await Promise.all(
        editedIndexes.map(async (slideIndex) => {
          try {
            const res = await fetch(`${SERVER_URL}/rooms/${roomId}/slides/${slideIndex}/note`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ newNote: drafts[slideIndex], editedByName: myName }),
            });
            const data = await res.json();
            return { slideIndex, ok: res.ok && data.success, message: data.message };
          } catch (e) {
            return { slideIndex, ok: false, message: '서버 연결 실패' };
          }
        })
      );

      const succeeded = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);

      if (succeeded.length > 0) {
        // 로컬 slideNotes 캐시도 성공한 슬라이드만큼 갱신
        const succeededIndexes = new Set(succeeded.map((r) => r.slideIndex));
        const updated = slideNotes.filter((n) => !succeededIndexes.has(n.slideIndex));
        succeeded.forEach((r) => updated.push({ slideIndex: r.slideIndex, text: drafts[r.slideIndex] }));
        useKitStore.setState({ slideNotes: updated });

        // 성공한 슬라이드는 초안 목록에서 제거 (실패한 건 남겨둬서 다시 저장 시도 가능하게)
        setDrafts((prev) => {
          const next = { ...prev };
          succeeded.forEach((r) => delete next[r.slideIndex]);
          return next;
        });
      }

      if (failed.length === 0) {
        setStatusText(`슬라이드 ${succeeded.map((r) => r.slideIndex).join(', ')} 저장됨 · 방금`);
      } else {
        setStatusText('일부 저장 실패');
        Alert.alert('일부 저장 실패', `슬라이드 ${failed.map((r) => r.slideIndex).join(', ')} 저장에 실패했어요. 다시 시도해주세요.`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={handleBack}>
          <Text style={styles.backBtnText}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>노트 수정</Text>
        <Pressable style={styles.saveBtn} onPress={handleSaveAll}>
          <Text style={styles.saveBtnText}>
            {saving ? '저장 중...' : editedCount > 0 ? `저장 (${editedCount})` : '저장'}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.slideFrame}>
          <Text style={styles.slideIdx}>SLIDE {currentIndex} / {slideCount || '-'}</Text>
          {editedIndexes.includes(currentIndex) && (
            <View style={styles.editedDot}>
              <Text style={styles.editedDotText}>저장 안 됨</Text>
            </View>
          )}
          {imageUrl && !imageFailed ? (
            <Image
              source={{ uri: imageUrl }}
              style={StyleSheet.absoluteFillObject}
              contentFit="contain"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <Text style={styles.slideTitle}>슬라이드 미리보기 준비 중</Text>
          )}
        </View>

        <View style={styles.navRow}>
          <Pressable style={styles.navBtn} onPress={() => goToSlide(-1)} disabled={currentIndex <= 1}>
            <Text style={[styles.navBtnText, currentIndex <= 1 && styles.disabled]}>‹</Text>
          </Pressable>
          <Text style={styles.navLabel}>
            {currentIndex} / {slideCount || '-'}
            {editedCount > 0 ? `  ·  수정됨: 슬라이드 ${editedIndexes.join(', ')}` : ''}
          </Text>
          <Pressable style={styles.navBtn} onPress={() => goToSlide(1)} disabled={currentIndex >= slideCount}>
            <Text style={[styles.navBtnText, currentIndex >= slideCount && styles.disabled]}>›</Text>
          </Pressable>
        </View>

        <TextInput
          style={styles.textarea}
          multiline
          value={text}
          onChangeText={handleChangeText}
          placeholder="이 슬라이드의 발표자 노트를 입력하세요"
        />

        {statusText ? <Text style={styles.statusText}>{statusText}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingTop: 56, paddingHorizontal: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: colors.hairline,
  },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  backBtnText: { fontSize: 24, color: colors.ink },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.ink },
  saveBtn: { backgroundColor: colors.spot, borderRadius: 11, paddingVertical: 9, paddingHorizontal: 16 },
  saveBtnText: { color: colors.spotInk, fontWeight: '700', fontSize: 13 },

  body: { padding: 20, gap: 14 },
  slideFrame: {
    aspectRatio: 16 / 9, borderRadius: radius.md, backgroundColor: colors.surfaceRaised,
    borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center',
  },
  slideIdx: { position: 'absolute', top: 10, left: 12, fontSize: 11, color: colors.inkFaint },
  slideTitle: { fontSize: 15, fontWeight: '700', color: colors.inkDim },
  editedDot: {
    position: 'absolute', top: 10, right: 12, zIndex: 1,
    backgroundColor: colors.alert, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
  },
  editedDotText: { fontSize: 10, fontWeight: '700', color: colors.alertInk },

  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: 38, height: 38, borderRadius: 999, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  navBtnText: { fontSize: 20, color: colors.ink },
  navLabel: { fontSize: 12, color: colors.inkFaint },
  disabled: { opacity: 0.3 },

  textarea: {
    minHeight: 160, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.hairline,
    borderRadius: radius.md, padding: 14, fontSize: 14.5, lineHeight: 21, color: colors.ink,
    textAlignVertical: 'top',
  },
  statusText: { fontSize: 11.5, color: colors.inkFaint, textAlign: 'center' },
});