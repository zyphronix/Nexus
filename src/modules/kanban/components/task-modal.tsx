'use client';

import { useState, useEffect } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useTasksStore } from '@/stores/tasks-store';
import { updateTask, deleteTask, getTaskEvents } from '@/modules/kanban/actions';
import {
  createDependency,
  deleteDependency,
  getDependencies,
} from '@/modules/kanban/dependency-actions';
import type { TaskStatus, TaskPriority } from '@/core/db/schema';
import type { TaskEventWithUser } from '@/core/db/queries/tasks';
import type { TaskDependencyWithTasks } from '@/core/db/queries/dependencies';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Clock,
  User,
  Calendar,
  Activity,
  Trash2,
  Save,
  Edit2,
  X,
  GitBranch,
} from 'lucide-react';

export function TaskModal() {
  const { taskModalOpen, selectedTaskId, closeTaskModal } = useUIStore();
  const { tasks, updateTask: updateTaskInStore, deleteTask: deleteTaskFromStore } = useTasksStore();
  
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [taskEvents, setTaskEvents] = useState<TaskEventWithUser[]>([]);
  const [projectDependencies, setProjectDependencies] = useState<TaskDependencyWithTasks[]>([]);
  const [selectedBlockerId, setSelectedBlockerId] = useState('none');
  const [isDependencySaving, setIsDependencySaving] = useState(false);
  
  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('backlog');
  const [priority, setPriority] = useState<TaskPriority>('medium');

  // Find the selected task
  const task = tasks.find((t) => t.id === selectedTaskId);

  // Reset form when task changes
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
      setStatus(task.status);
      setPriority(task.priority);
      setIsEditing(false);
    }
  }, [task]);

  useEffect(() => {
    if (!taskModalOpen || !task) {
      setTaskEvents([]);
      setProjectDependencies([]);
      return;
    }

    let isMounted = true;

    const loadTaskEvents = async () => {
      const result = await getTaskEvents(task.id);
      if (!isMounted) return;

      if (result.success && result.data) {
        setTaskEvents(result.data);
      } else {
        setTaskEvents([]);
      }
    };

    const loadDependencies = async () => {
      const result = await getDependencies(task.projectId);
      if (!isMounted) return;
      setProjectDependencies(result.success && result.data ? result.data : []);
    };

    loadTaskEvents();
    loadDependencies();

    return () => {
      isMounted = false;
    };
  }, [taskModalOpen, task]);

  const taskBlockers = projectDependencies.filter(
    (dependency) => dependency.task.id === task?.id,
  );

  const availableBlockers = tasks.filter(
    (candidate) =>
      candidate.id !== task?.id &&
      !taskBlockers.some((dependency) => dependency.dependsOnTask.id === candidate.id),
  );

  const refreshDependencies = async () => {
    if (!task) return;
    const result = await getDependencies(task.projectId);
    if (result.success && result.data) setProjectDependencies(result.data);
  };

  const handleAddDependency = async () => {
    if (!task || selectedBlockerId === 'none') return;
    setIsDependencySaving(true);
    const result = await createDependency({
      projectId: task.projectId,
      taskId: task.id,
      dependsOnTaskId: selectedBlockerId,
    });
    if (result.success) {
      setSelectedBlockerId('none');
      await refreshDependencies();
      window.dispatchEvent(new Event('task-dependencies-changed'));
      toast.success('Dependency added');
    } else {
      toast.error(result.error || 'Failed to add dependency');
    }
    setIsDependencySaving(false);
  };

  const handleRemoveDependency = async (dependency: TaskDependencyWithTasks) => {
    if (!task) return;
    setIsDependencySaving(true);
    const result = await deleteDependency({
      projectId: task.projectId,
      taskId: dependency.task.id,
      dependsOnTaskId: dependency.dependsOnTask.id,
    });
    if (result.success) {
      await refreshDependencies();
      window.dispatchEvent(new Event('task-dependencies-changed'));
      toast.success('Dependency removed');
    } else {
      toast.error(result.error || 'Failed to remove dependency');
    }
    setIsDependencySaving(false);
  };

  const getEventDescription = (event: TaskEventWithUser) => {
    switch (event.eventType) {
      case 'created':
        return 'Task created';
      case 'status_changed':
        return `Status changed to ${
          event.newValue ? getStatusLabel(event.newValue as TaskStatus) : 'unknown'
        }`;
      case 'assigned':
        return `Task assigned to ${event.newValue ?? 'unknown'}`;
      case 'deleted':
        return 'Task deleted';
      case 'updated':
      default:
        return 'Task updated';
    }
  };

  const handleSave = async () => {
    if (!task) return;

    setIsSaving(true);
    try {
      const result = await updateTask({
        id: task.id,
        projectId: task.projectId,
        title,
        description,
        status,
        priority,
      });

      if (result.success && result.data) {
        updateTaskInStore(task.id, result.data);
        toast.success('Task updated successfully');
        setIsEditing(false);
      } else {
        toast.error(result.error || 'Failed to update task');
      }
    } catch {
      toast.error('An error occurred while updating the task');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;

    setIsDeleting(true);
    try {
      const result = await deleteTask(task.id, task.projectId);

      if (result.success) {
        deleteTaskFromStore(task.id);
        toast.success('Task deleted successfully');
        closeTaskModal();
      } else {
        toast.error(result.error || 'Failed to delete task');
      }
    } catch {
      toast.error('An error occurred while deleting the task');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancel = () => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
      setStatus(task.status);
      setPriority(task.priority);
    }
    setIsEditing(false);
  };

  const getPriorityColor = (priority: TaskPriority) => {
    switch (priority) {
      case 'high':
        return 'destructive';
      case 'medium':
        return 'default';
      case 'low':
        return 'secondary';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status: TaskStatus) => {
    switch (status) {
      case 'backlog':
        return 'Backlog';
      case 'todo':
        return 'To Do';
      case 'in_progress':
        return 'In Progress';
      case 'done':
        return 'Done';
      default:
        return status;
    }
  };

  if (!task) return null;

  return (
    <Dialog open={taskModalOpen} onOpenChange={closeTaskModal}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto soft-scrollbar">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <DialogTitle className="text-2xl">
              {isEditing ? 'Edit Task' : 'Task Details'}
            </DialogTitle>
            {!isEditing && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsEditing(true)}
                className="h-8 w-8"
              >
                <Edit2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            {isEditing ? (
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter task title"
              />
            ) : (
              <p className="text-lg font-medium">{task.title}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            {isEditing ? (
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter task description"
                rows={4}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {task.description || 'No description provided'}
              </p>
            )}
          </div>

          {/* Status and Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              {isEditing ? (
                <Select value={status} onValueChange={(value) => setStatus(value as TaskStatus)}>
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="backlog">Backlog</SelectItem>
                    <SelectItem value="todo">To Do</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="outline">{getStatusLabel(task.status)}</Badge>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              {isEditing ? (
                <Select
                  value={priority}
                  onValueChange={(value) => setPriority(value as TaskPriority)}
                >
                  <SelectTrigger id="priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant={getPriorityColor(task.priority)}>
                  {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                </Badge>
              )}
            </div>
          </div>

          {/* Metadata */}
          {!isEditing && (
            <div className="space-y-3 border-t border-white/20 pt-4 dark:border-white/10">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>Created: {new Date(task.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>Updated: {new Date(task.updatedAt).toLocaleDateString()}</span>
              </div>
              {task.assigneeId && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-4 w-4" />
                  <span>Assignee: {task.assigneeId}</span>
                </div>
              )}
            </div>
          )}

          {!isEditing && (
            <div className="space-y-3 border-t border-white/20 pt-4 dark:border-white/10">
              <div className="flex items-center gap-2 font-medium">
                <GitBranch className="h-4 w-4" />
                <span>Dependencies</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Add tasks that must be completed before this task can start.
              </p>
              <div className="flex gap-2">
                <Select value={selectedBlockerId} onValueChange={setSelectedBlockerId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select a blocker" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select a blocker</SelectItem>
                    {availableBlockers.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  onClick={handleAddDependency}
                  disabled={isDependencySaving || selectedBlockerId === 'none'}
                >
                  Add
                </Button>
              </div>
              <div className="space-y-2">
                {taskBlockers.map((dependency) => (
                  <div
                    key={dependency.id}
                    className="flex items-center justify-between rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-sm"
                  >
                    <span className="truncate">Blocked by {dependency.dependsOnTask.title}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveDependency(dependency)}
                      disabled={isDependencySaving}
                      aria-label={`Remove dependency on ${dependency.dependsOnTask.title}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {taskBlockers.length === 0 && (
                  <p className="text-sm text-muted-foreground">No blockers configured.</p>
                )}
              </div>
            </div>
          )}

          {/* Activity Timeline */}
          {!isEditing && (
            <div className="space-y-3 border-t border-white/20 pt-4 dark:border-white/10">
              <div className="flex items-center gap-2 font-medium">
                <Activity className="h-4 w-4" />
                <span>Activity</span>
              </div>
              <div className="space-y-3">
                {taskEvents.map((event) => (
                  <div key={event.id} className="flex gap-3 text-sm">
                    <div className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
                    <div className="flex-1">
                      <p className="text-foreground">{getEventDescription(event)}</p>
                      <p className="text-xs text-muted-foreground">
                        {event.userName || event.userId || 'Unknown user'} •{' '}
                        {new Date(event.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
                {taskEvents.length === 0 && (
                  <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {isEditing ? (
            <>
              <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
              <Button variant="outline" onClick={closeTaskModal}>
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
