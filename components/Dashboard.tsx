import React, { useMemo, useState } from 'react';
import type { SubjectGrade } from '../types';

// --- Типы данных для дашборда ---
interface SubjectAnalytics {
  avgScore: number | null;
  gradeCount: number;
  absences: number;
}

interface StudentAnalytics {
  id: string;
  name: string;
  overallAvgScore: number | null;
  rank: number;
  totalAbsences: number;
  subjects: Record<string, SubjectAnalytics>;
}

const getAvgGradeColor = (score: number | null): string => {
    if (score === null) return 'text-gray-500 dark:text-gray-400';
    if (score >= 86) return 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-300';
    if (score >= 71) return 'bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300';
    if (score >= 56) return 'bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300';
    return 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-300';
};

// --- Карточка студента ---
const StudentAnalyticsCard: React.FC<{ student: StudentAnalytics }> = ({ student }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div 
            className="bg-white/40 dark:bg-dark-secondary/50 backdrop-blur-3xl border border-white/30 dark:border-white/10 shadow-soft-lg dark:shadow-dark-soft-lg rounded-3xl transition-all duration-300 ease-in-out p-4 cursor-pointer"
            onClick={() => setIsExpanded(!isExpanded)}
        >
            <div className="flex items-center justify-between">
                <div className="min-w-0">
                    <p className="font-bold text-text-primary dark:text-dark-text-primary truncate">{student.name}</p>
                    <p className="text-xs text-text-secondary dark:text-dark-text-secondary">Место в рейтинге: {student.rank}</p>
                </div>
                <div className="flex items-center gap-4 text-center">
                    <div>
                        <p className="font-bold text-xl text-accent dark:text-dark-accent">{student.overallAvgScore?.toFixed(2) ?? '–'}</p>
                        <p className="text-xs text-text-secondary dark:text-dark-text-secondary">Cр. балл</p>
                    </div>
                     <div>
                        <p className="font-bold text-xl text-red-600 dark:text-red-400">{student.totalAbsences}</p>
                        <p className="text-xs text-text-secondary dark:text-dark-text-secondary">Отработки</p>
                    </div>
                </div>
            </div>

            {isExpanded && (
                <div className="mt-4 pt-4 border-t border-border-color dark:border-dark-border-color space-y-2 animate-fade-in">
                    <h4 className="font-bold text-sm text-text-primary dark:text-dark-text-primary mb-2">Успеваемость по предметам:</h4>
                    
                    {/* Grid Header */}
                    <div className="grid grid-cols-[1fr_5rem_6rem] gap-x-4 px-2 pb-1 text-xs font-semibold text-text-secondary dark:text-dark-text-secondary">
                        <span>Предмет</span>
                        <span className="text-center">Ср. балл</span>
                        <span className="text-center">Задолженности</span>
                    </div>
                    
                    {/* Student's subjects */}
                    <div className="space-y-2">
                        {/* FIX: Replaced Object.entries with Object.keys to fix a TypeScript type inference issue where subjectData was 'unknown'. Accessing properties via student.subjects[subjectName] provides the correct type. */}
                        {Object.keys(student.subjects).sort((a, b) => a.localeCompare(b)).map((subjectName) => {
                            const subjectData = student.subjects[subjectName];
                            return (
                            <div key={subjectName} className="grid grid-cols-[1fr_5rem_6rem] gap-x-4 items-center bg-white/50 dark:bg-dark-primary/60 backdrop-blur-sm p-2 rounded-xl text-sm">
                                {/* Subject Name */}
                                <span className="font-medium text-text-primary dark:text-dark-text-primary truncate pr-2">
                                    {subjectName}
                                </span>
                                
                                {/* Average Score */}
                                <div className="flex flex-col items-center text-center">
                                    <span className={`font-bold py-1 px-2 rounded-md text-xs w-full ${getAvgGradeColor(subjectData.avgScore)}`}>
                                        {subjectData.avgScore?.toFixed(2) ?? '–'}
                                    </span>
                                    <span className="text-xs text-text-secondary dark:text-dark-text-secondary mt-1">
                                        {subjectData.gradeCount} {subjectData.gradeCount === 1 ? 'оценка' : 'оценок'}
                                    </span>
                                </div>

                                {/* Absences */}
                                <div className="flex flex-col items-center text-center">
                                    <span className={`font-semibold text-base ${subjectData.absences > 0 ? 'text-red-600 dark:text-red-400' : 'text-text-secondary dark:text-dark-text-secondary'}`}>
                                        {subjectData.absences > 0 ? subjectData.absences : '–'}
                                    </span>
                                    <span className="text-xs text-text-secondary dark:text-dark-text-secondary">
                                        {subjectData.absences > 0 ? 'долгов' : 'нет'}
                                    </span>
                                </div>
                            </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};


// --- Основной компонент дашборда ---
interface DashboardProps {
    allGrades: SubjectGrade[];
    isLoading: boolean;
}

const Dashboard: React.FC<DashboardProps> = ({ allGrades, isLoading }) => {
    const [searchTerm, setSearchTerm] = useState('');

    const studentAnalytics = useMemo((): StudentAnalytics[] => {
        if (!allGrades.length) return [];

        const gradesByStudent: Record<string, SubjectGrade[]> = allGrades.reduce((acc, grade) => {
            if (!acc[grade.user_id]) acc[grade.user_id] = [];
            acc[grade.user_id].push(grade);
            return acc;
        }, {} as Record<string, SubjectGrade[]>);
        
        const analyticsData = Object.entries(gradesByStudent).map(([id, grades]) => {
            const name = grades[0]?.user_name || `User ${id}`;
            const overallAvgScore = grades.find(g => g.avg_score !== undefined)?.avg_score ?? null;
            const totalAbsences = grades.filter(g => g.score === 'н').length;
            
            // FIX: Refactored subject analytics calculation to be type-safe and more readable.
            // The original implementation had a type mismatch that caused build errors.
            // This new approach first groups grades by subject, then calculates the analytics for each subject.
            const gradesBySubjectForStudent: Record<string, SubjectGrade[]> = grades.reduce((acc, grade) => {
                if (!acc[grade.subject]) {
                    acc[grade.subject] = [];
                }
                acc[grade.subject].push(grade);
                return acc;
            }, {} as Record<string, SubjectGrade[]>);

            const subjects: Record<string, SubjectAnalytics> = Object.fromEntries(
                Object.entries(gradesBySubjectForStudent).map(([subjectName, subjectGrades]) => {
                    const numericGrades = subjectGrades.map(g => g.score).filter(s => typeof s === 'number') as number[];
                    const gradeCount = subjectGrades.filter(g => g.score !== 'н' && g.score !== 'б' && g.score !== null).length;
                    const absences = subjectGrades.filter(g => g.score === 'н').length;
                    let avgScore: number | null = null;
                    if (numericGrades.length > 0) {
                        avgScore = numericGrades.reduce((sum, score) => sum + score, 0) / numericGrades.length;
                    }
                    const analytics: SubjectAnalytics = { avgScore, gradeCount, absences };
                    return [subjectName, analytics];
                })
            );

            return { id, name, overallAvgScore, totalAbsences, subjects, rank: 0 };
        });

        // Calculate ranks
        analyticsData.sort((a, b) => (b.overallAvgScore ?? 0) - (a.overallAvgScore ?? 0));
        let currentRank = 0;
        let lastScore = -1;
        analyticsData.forEach((student, index) => {
            if (student.overallAvgScore !== lastScore) {
                currentRank = index + 1;
                lastScore = student.overallAvgScore!;
            }
            student.rank = currentRank;
        });

        return analyticsData.sort((a, b) => a.name.localeCompare(b.name));
    }, [allGrades]);

    const filteredStudents = useMemo(() => {
        if (!searchTerm) return studentAnalytics;
        return studentAnalytics.filter(s =>
            s.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [studentAnalytics, searchTerm]);

    if (isLoading) {
        return (
            <div className="animate-fade-in space-y-4">
                 <div className="bg-secondary dark:bg-dark-secondary p-4 rounded-3xl animate-pulse h-14"></div>
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="bg-secondary dark:bg-dark-secondary p-4 rounded-3xl animate-pulse h-20"></div>
                ))}
            </div>
        );
    }

    return (
        <div className="animate-fade-in space-y-4">
            <div className="relative">
                <i className="ph-bold ph-magnifying-glass absolute top-1/2 left-4 -translate-y-1/2 text-text-secondary dark:text-dark-text-secondary"></i>
                <input
                    type="text"
                    placeholder="Найти студента..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full bg-white/40 dark:bg-dark-secondary/50 backdrop-blur-3xl border border-white/30 dark:border-white/10 shadow-soft-lg dark:shadow-dark-soft-lg rounded-3xl py-3 pl-11 pr-4 text-text-primary dark:text-dark-text-primary placeholder:text-text-secondary dark:placeholder:text-dark-text-secondary focus:outline-none focus:ring-2 focus:ring-accent dark:focus:ring-dark-accent"
                />
            </div>
            {filteredStudents.length > 0 ? (
                filteredStudents.map(student => (
                    <StudentAnalyticsCard key={student.id} student={student} />
                ))
            ) : (
                <div className="text-center py-10 text-text-secondary dark:text-dark-text-secondary">
                    <p>Студенты не найдены.</p>
                </div>
            )}
        </div>
    );
};

export default Dashboard;