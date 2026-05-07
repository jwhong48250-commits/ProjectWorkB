import { useEffect, useState, type FormEvent } from 'react'
import { Building2, Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { getCurrentWorkspaceId } from '../../api/client'
import {
  createDepartment,
  deleteDepartment,
  getDepartments,
  getWorkspaceMembers,
  updateDepartment,
  type Department,
  type WorkspaceMember,
} from '../../api/workspace'

const DEPARTMENT_TABLE_GRID = 'md:grid-cols-[minmax(14rem,1fr)_6rem_7.5rem_12rem]'

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export default function DepartmentsSettingsPage() {
  const [departments, setDepartments] = useState<Department[]>([])
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const workspaceId = getCurrentWorkspaceId()

  useEffect(() => {
    let active = true

    async function loadDepartments() {
      setLoading(true)
      setError('')

      try {
        const [departmentList, memberList] = await Promise.all([
          getDepartments(workspaceId),
          getWorkspaceMembers(workspaceId),
        ])
        if (!active) return
        setDepartments(departmentList)
        setMembers(memberList)
      } catch (err) {
        if (!active) return
        setError(err instanceof Error ? err.message : '부서 정보를 불러오지 못했습니다.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadDepartments()

    return () => {
      active = false
    }
  }, [workspaceId])

  function getDepartmentMemberCount(departmentId: number): number {
    return members.filter((member) => member.department_id === departmentId).length
  }

  async function handleCreateDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = newName.trim()
    if (!trimmedName) {
      setError('부서명을 입력해 주세요.')
      return
    }

    setSaving(true)
    setError('')

    try {
      const department = await createDepartment(workspaceId, trimmedName)
      setDepartments((prev) => [...prev, department])
      setNewName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '부서 생성에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  function startEditing(department: Department) {
    setEditingId(department.department_id)
    setEditingName(department.name)
    setError('')
  }

  function cancelEditing() {
    setEditingId(null)
    setEditingName('')
  }

  async function handleUpdateDepartment(departmentId: number) {
    const trimmedName = editingName.trim()
    if (!trimmedName) {
      setError('수정할 부서명을 입력해 주세요.')
      return
    }

    setSaving(true)
    setError('')

    try {
      const updated = await updateDepartment(workspaceId, departmentId, trimmedName)
      setDepartments((prev) => (
        prev.map((department) => (
          department.department_id === departmentId ? updated : department
        ))
      ))
      cancelEditing()
    } catch (err) {
      setError(err instanceof Error ? err.message : '부서 수정에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteDepartment(department: Department) {
    const memberCount = getDepartmentMemberCount(department.department_id)
    const message = memberCount > 0
      ? `${department.name} 부서에 소속된 멤버가 ${memberCount}명 있습니다. 그래도 삭제하시겠습니까?`
      : `${department.name} 부서를 삭제하시겠습니까?`

    if (!window.confirm(message)) return

    setSaving(true)
    setError('')

    try {
      await deleteDepartment(workspaceId, department.department_id)
      setDepartments((prev) => (
        prev.filter((item) => item.department_id !== department.department_id)
      ))
      setMembers((prev) => (
        prev.map((member) => (
          member.department_id === department.department_id
            ? { ...member, department_id: null, department: null }
            : member
        ))
      ))
    } catch (err) {
      setError(err instanceof Error ? err.message : '부서 삭제에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <p className="text-sm text-muted-foreground">부서 정보를 불러오는 중입니다...</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">부서 관리</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            워크스페이스의 부서를 생성하고 멤버 배정 기준으로 사용할 수 있습니다.
          </p>
        </div>
        <span className="self-start sm:self-auto px-2.5 py-1 rounded-full bg-muted text-mini text-muted-foreground">
          총 {departments.length}개 부서
        </span>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <form onSubmit={handleCreateDepartment} className="p-3.5 rounded-lg border border-border bg-card mb-5">
        <label className="block text-sm font-medium text-foreground mb-1.5">새 부서 추가</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="예: 개발팀, 디자인팀, 기획팀"
            className="flex-1 h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
          <button
            type="submit"
            disabled={saving}
            className="flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Plus size={14} /> 추가
          </button>
        </div>
      </form>

      <div className="rounded-lg border border-border overflow-hidden bg-card">
        <div className={`hidden md:grid ${DEPARTMENT_TABLE_GRID} gap-3 px-6 py-2 bg-muted/40 border-b border-border text-center text-micro font-medium text-muted-foreground uppercase tracking-wide`}>
          <span className="text-left md:pl-14">부서명</span>
          <span>소속 멤버</span>
          <span>생성일</span>
          <span>관리</span>
        </div>

        {departments.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
            <Building2 size={32} className="text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">아직 등록된 부서가 없습니다.</p>
          </div>
        ) : departments.map((department) => {
          const isEditing = editingId === department.department_id
          const memberCount = getDepartmentMemberCount(department.department_id)

          return (
            <div key={department.department_id} className="px-6 py-3 border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
              <div className={`grid grid-cols-1 ${DEPARTMENT_TABLE_GRID} gap-3 md:items-center`}>
                <div className="min-w-0 md:pl-5">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                      autoFocus
                    />
                  ) : (
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-accent-subtle flex items-center justify-center shrink-0">
                        <Building2 size={15} className="text-accent" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{department.name}</p>
                        <p className="md:hidden text-mini text-muted-foreground">
                          소속 멤버 {memberCount}명 · {formatDate(department.created_at)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <span className="hidden text-center text-mini text-muted-foreground md:inline">{memberCount}명</span>
                <span className="hidden text-center text-mini text-muted-foreground md:inline">{formatDate(department.created_at)}</span>

                <div className="flex items-center gap-1.5 justify-end md:justify-center">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleUpdateDepartment(department.department_id)}
                        disabled={saving}
                        className="flex items-center gap-1 h-8 px-2.5 rounded border border-border text-mini hover:bg-muted transition-colors disabled:opacity-60"
                      >
                        <Check size={13} /> 저장
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        className="flex items-center gap-1 h-8 px-2.5 rounded border border-border text-mini hover:bg-muted transition-colors"
                      >
                        <X size={13} /> 취소
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => startEditing(department)}
                        className="flex items-center gap-1 h-8 px-2.5 rounded border border-border text-mini hover:bg-muted transition-colors"
                      >
                        <Pencil size={13} /> 수정
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDepartment(department)}
                        disabled={saving}
                        className="flex items-center gap-1 h-8 px-2.5 rounded border border-red-200 text-mini text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60"
                      >
                        <Trash2 size={13} /> 삭제
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
