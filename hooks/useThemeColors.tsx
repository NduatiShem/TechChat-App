import { useTheme } from "@/context/ThemeContext";
import { colors } from "@/constants/colors";

export const useThemeColors = () => {
    const { currentTheme } = useTheme();
    return colors[currentTheme];
};