import { add, greet } from './utils.js';

export interface User {
  id: number;
  name: string;
}

export class UserService {
  private users: User[] = [];

  addUser(user: User): void {
    this.users.push(user);
  }

  getUser(id: number): User | undefined {
    return this.users.find(u => u.id === id);
  }

  greetUser(id: number): string {
    const user = this.getUser(id);
    return user ? greet(user.name) : 'User not found';
  }

  totalUsers(): number {
    return add(this.users.length, 0);
  }
}
