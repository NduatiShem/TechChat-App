declare module 'emoji-mart-native' {
  import { Component } from 'react';

  export interface Emoji {
    id: string;
    name: string;
    native: string;
    unified: string;
    keywords: string[];
    shortNames: string[];
    emoticons: string[];
  }

  export interface PickerProps {
    onSelect?: (emoji: Emoji) => void;
    theme?: 'light' | 'dark' | 'auto';
    showPreview?: boolean;
    showSkinTones?: boolean;
    emojiSize?: number;
    perLine?: number;
    style?: any;
  }

  export class Picker extends Component<PickerProps> {}
}

