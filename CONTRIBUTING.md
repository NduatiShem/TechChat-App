# Contributing to TechChat App

Thank you for your interest in contributing to TechChat! This document provides guidelines and instructions for contributing.

## Development Workflow

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/your-username/TechChat-App.git
cd TechChat-App
```

### 2. Create a Branch

```bash
# Create a feature branch from develop
git checkout develop
git pull origin develop
git checkout -b feature/your-feature-name
```

### 3. Make Changes

- Write clean, maintainable code
- Follow existing code style and patterns
- Add comments for complex logic
- Update documentation if needed

### 4. Test Your Changes

```bash
# Run linting
npm run lint

# Type check
npx tsc --noEmit

# Test on device/emulator
npm start
```

### 5. Commit Your Changes

Use clear, descriptive commit messages:

```bash
git add .
git commit -m "feat: add dark mode toggle to settings"
```

**Commit Message Format:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding tests
- `chore:` - Maintenance tasks

### 6. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub from your branch to `develop`.

## Code Standards

### TypeScript

- Use TypeScript for all new code
- Define proper types and interfaces
- Avoid `any` types when possible
- Use type inference where appropriate

### React Native

- Use functional components with hooks
- Keep components small and focused
- Extract reusable logic into custom hooks
- Use Context API for global state

### Styling

- Use NativeWind (Tailwind CSS) for styling
- Follow existing design patterns
- Ensure dark mode compatibility
- Test on both iOS and Android

### File Organization

```
app/                    # Screen components
components/             # Reusable components
context/                # React contexts
services/               # API and business logic
utils/                  # Utility functions
hooks/                  # Custom React hooks
```

## Pull Request Guidelines

### Before Submitting

- [ ] Code follows project style guidelines
- [ ] All linting errors are fixed
- [ ] TypeScript compiles without errors
- [ ] Tested on both iOS and Android (if applicable)
- [ ] No console.log statements (use proper logging)
- [ ] Documentation updated if needed

### PR Description

Include:
- **What**: What changes were made
- **Why**: Why these changes were needed
- **How**: How to test the changes
- **Screenshots**: If UI changes were made

### Review Process

1. CI must pass (linting, type checking)
2. Code review by maintainers
3. Address any feedback
4. Once approved, maintainer will merge

## Reporting Issues

### Bug Reports

Include:
- **Description**: Clear description of the bug
- **Steps to Reproduce**: Step-by-step instructions
- **Expected Behavior**: What should happen
- **Actual Behavior**: What actually happens
- **Environment**: Device, OS version, app version
- **Screenshots**: If applicable

### Feature Requests

Include:
- **Description**: Clear description of the feature
- **Use Case**: Why this feature would be useful
- **Proposed Solution**: How you envision it working
- **Alternatives**: Other solutions considered

## Code Review Checklist

When reviewing code, check:

- [ ] Code follows project conventions
- [ ] No security vulnerabilities
- [ ] Proper error handling
- [ ] Accessibility considerations
- [ ] Performance implications
- [ ] Test coverage (if applicable)
- [ ] Documentation updated

## Getting Help

- Open an issue on GitHub
- Check existing documentation
- Review similar code in the codebase

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.

