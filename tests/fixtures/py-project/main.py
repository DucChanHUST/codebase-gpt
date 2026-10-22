def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b

def greet(name: str) -> str:
    return f"Hello, {name}!"

class Calculator:
    def __init__(self):
        self.history = []

    def compute(self, a: int, b: int) -> int:
        result = add(a, b)
        self.history.append(result)
        return result

    def _private_helper(self):
        pass
