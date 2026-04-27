import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DEFAULT_TASK_STATUS, type TaskStatus } from './task-status';

// Representa a tarefa persistida no SQLite, incluindo hierarquia e status.
@Entity({ name: 'tasks' })
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 160 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  label!: string | null;

  @Column({ name: 'parent_id', type: 'varchar', length: 36, nullable: true })
  parentId!: string | null;

  @Column({ name: 'root_id', type: 'varchar', length: 36, nullable: true })
  rootId!: string | null;

  @Column({ type: 'integer', default: 0 })
  position!: number;

  @Column({ type: 'varchar', length: 16, default: DEFAULT_TASK_STATUS })
  status!: TaskStatus;

  @Column({ name: 'is_completed', type: 'boolean', default: false })
  isCompleted!: boolean;

  @Column({ name: 'is_ai_generated', type: 'boolean', default: false })
  isAiGenerated!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
