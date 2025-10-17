/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: Update this to include the paths to all of your component files.
  content: ["./{app,components}/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary:{
          DEFAULT: '#283891',  // Your primary color
          light: '#3B4BA3',    // Lighter variant
          dark: '#1E2A7A',     // Darker variant
        },
        secondary:{
          DEFAULT: '#39B54A',  // Your secondary color
          light: '#4BC55A',    // Lighter variant
          dark: '#2D8F3A',     // Darker variant
        },
        success: '#39B54A',    // Using secondary for success
        accent: '#39B54A',     // Using secondary for accent
      },
    },
  },
  plugins: [],
}