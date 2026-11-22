import { Component, type ReactNode } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';

type State = { error?: Error };

/**
 * Catches render errors of a route so a bug in Settings/Diagnostics shows its message (with a Copy/Share button)
 * instead of taking the whole app down.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const text = `${this.props.label} failed to render\n${error.name}: ${error.message}\n${error.stack ?? ''}`;
    return (
      <View style={{ flex: 1, backgroundColor: '#121212', padding: 24, paddingTop: 80 }}>
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 12 }}>{this.props.label} hit an error</Text>
        <ScrollView style={{ flex: 1 }}>
          <Text selectable style={{ color: '#ff8a8a', fontFamily: 'Menlo', fontSize: 12 }}>
            {text}
          </Text>
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
          <Pressable onPress={() => void Share.share({ message: text })} accessibilityRole="button" accessibilityLabel="Copy error" style={{ backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12 }}>
            <Text style={{ color: '#000', fontWeight: '700' }}>Copy</Text>
          </Pressable>
          <Pressable onPress={() => this.setState({ error: undefined })} accessibilityRole="button" accessibilityLabel="Try again" style={{ backgroundColor: '#333', borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}
