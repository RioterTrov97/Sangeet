import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useMoodPage } from '../youtube/queries';
import { Row } from './ui';
import { tv } from './theme';

/** A mood/genre browse page as a stack of rows. */
export function ShelvesTV({ params, title }: { params: string; title: string }) {
  const { data, isLoading, isError } = useMoodPage(params);
  return (
    <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>
      <Text style={st.title}>{title}</Text>
      {isLoading ? (
        <View style={st.center}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : null}
      {isError ? <Text style={st.msg}>Could not load this page</Text> : null}
      {(data ?? []).map((s, i) => (
        <Row key={`${s.title}-${i}`} id={`mood-page-${params}-${s.title}`} title={s.title} items={s.items} source="mood" />
      ))}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  content: { paddingTop: 30, paddingBottom: 80 },
  title: { color: tv.text, fontFamily: tv.font.extraBold, fontSize: 44, marginLeft: tv.gutter, marginBottom: 6 },
  center: { height: 300, alignItems: 'center', justifyContent: 'center' },
  msg: { color: tv.textDim, fontFamily: tv.font.medium, fontSize: 24, margin: tv.gutter },
});
