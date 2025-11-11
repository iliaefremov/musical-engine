import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { getRatingAnalysis, getAbsenceAnalysis } from '../services/geminiService';
import type { SubjectGrade, TelegramUser } from '../types';
import SubjectGradeCard from './SubjectGradeCard';
import BottomSheet from './BottomSheet';
import { RefreshIcon } from './icons/Icons';

type CacheEntry = { data: string; timestamp: number };

// Helper to group grades by subject
const groupGradesBySubject = (grades: SubjectGrade[]): Record<string, SubjectGrade[]> => {
    // We rely on the order from googleSheetsService (right-to-left parsing).
    // The reduce method preserves this order when pushing to arrays.
    return grades.reduce((acc, grade) => {
        if (!acc[grade.subject]) {
            acc[grade.subject] = [];
        }
        acc[grade.subject].push(grade);
        // No sorting here to preserve the original chronological order.
        return acc;
    }, {} as Record<string, SubjectGrade[]>);
};

// Helper to get correct plural form for Russian words
const getPluralForm = (number: number, one: string, two: string, five: string): string => {
    let n = Math.abs(number);
    n %= 100;
    if (n >= 5 && n <= 20) {
        return five;
    }
    n %= 10;
    if (n === 1) {
        return one;
    }
    if (n >= 2 && n <= 4) {
        return two;
    }
    return five;
};


interface GradesProps {
  user: TelegramUser | null;
  allGrades: SubjectGrade[];
  userGrades: SubjectGrade[];
  userLectureAbsences: SubjectGrade[];
  isLoading: boolean;
  error: string | null;
}

const Grades: React.FC<GradesProps> = ({ user, allGrades, userGrades, userLectureAbsences, isLoading, error }) => {
  const [isRatingSheetOpen, setRatingSheetOpen] = useState(false);
  const [isAbsencesSheetOpen, setAbsencesSheetOpen] = useState(false);
  
  // State for caching recommendations with timestamps
  const [ratingRecommendationCache, setRatingRecommendationCache] = useState<CacheEntry | null>(null);
  const [absenceRecommendationCache, setAbsenceRecommendationCache] = useState<CacheEntry | null>(null);
  const [analyticsCache, setAnalyticsCache] = useState<Record<string, CacheEntry | undefined>>({});

  const [isGeneratingRatingRec, setIsGeneratingRatingRec] = useState(false);
  const [isGeneratingAbsenceRec, setIsGeneratingAbsenceRec] = useState(false);
  const [activeAbsenceTab, setActiveAbsenceTab] = useState<'practicals' | 'lectures'>('practicals');
  const [isWarningVisible, setWarningVisible] = useState(false);
  
  const CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours

  const userId = user?.id.toString();

  const gradesBySubject = useMemo(() => {
    return groupGradesBySubject(userGrades);
  }, [userGrades]);

  const { rankedUsers, currentUserRank } = useMemo(() => {
    if (allGrades.length === 0 || !userId) return { rankedUsers: [], currentUserRank: null };
    
    const userAvgScores: Record<string, { scores: number[]; name: string; avg_from_sheet?: number }> = {};
     allGrades.forEach(g => {
        if (g.user_id) {
            if (!userAvgScores[g.user_id]) {
                userAvgScores[g.user_id] = { scores: [], name: g.user_name || `User ${g.user_id}` };
            }
            if (typeof g.avg_score === 'number' && userAvgScores[g.user_id].avg_from_sheet === undefined) {
                 userAvgScores[g.user_id].avg_from_sheet = g.avg_score;
            }
        }
    });

    const ranked = Object.entries(userAvgScores)
        .map(([id, stats], index) => ({
            id,
            name: stats.name,
            avg: stats.avg_from_sheet,
            rank: 0 // placeholder
        }))
        .filter(u => u.avg !== undefined)
        .sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0));
    
    // Assign rank, accounting for ties
    let currentRank = 0;
    let lastScore = -1;
    ranked.forEach((user, index) => {
        if (user.avg !== lastScore) {
            currentRank = index + 1;
            lastScore = user.avg!;
        }
        user.rank = currentRank;
    });

    const userRankData = ranked.find(u => u.id === userId);

    return {
        rankedUsers: ranked,
        currentUserRank: userRankData,
    };
  }, [allGrades, userId]);

  useEffect(() => {
    // Fetch only if the sheet is open and cache is invalid.
    if (isRatingSheetOpen && currentUserRank && user && !isGeneratingRatingRec) {
        const isCacheValid = ratingRecommendationCache && (Date.now() - ratingRecommendationCache.timestamp < CACHE_DURATION);
        
        if (!isCacheValid) {
            const fetchRecommendation = async () => {
                setIsGeneratingRatingRec(true);
                try {
                    const rec = await getRatingAnalysis(currentUserRank, rankedUsers, user.first_name);
                    setRatingRecommendationCache({ data: rec, timestamp: Date.now() });
                } catch (e) {
                    console.error(e);
                    setRatingRecommendationCache({ data: "Не удалось получить персональный совет из-за ошибки.", timestamp: Date.now() });
                } finally {
                    setIsGeneratingRatingRec(false);
                }
            };
            fetchRecommendation();
        }
    }
  }, [isRatingSheetOpen, ratingRecommendationCache, currentUserRank, rankedUsers, user]);

  const { totalAbsences, absencesBySubject } = useMemo(() => {
    const allAbsences = userGrades.filter(g => g.score === 'н');
    // FIX: Replaced inline reduce with the `groupGradesBySubject` helper to ensure correct type inference for `absencesBySubject`.
    const grouped = groupGradesBySubject(allAbsences);
    return {
        totalAbsences: allAbsences.length,
        absencesBySubject: grouped,
    }
  }, [userGrades]);

  const lectureAbsencesBySubject = useMemo(() => {
    return groupGradesBySubject(userLectureAbsences);
  }, [userLectureAbsences]);

    const subjectsWithManyAbsences = useMemo(() => {
        const WARNING_THRESHOLD = 3;
        // FIX: Added an Array.isArray type guard to prevent a runtime error.
        // The type of `subjectAbsences` was being inferred as `unknown` by TypeScript,
        // so this check ensures it's an array before accessing its `length` property.
        return Object.entries(absencesBySubject).filter(
            ([_, subjectAbsences]) => Array.isArray(subjectAbsences) && subjectAbsences.length >= WARNING_THRESHOLD
        );
    }, [absencesBySubject]);

  useEffect(() => {
    // Fetch only if the sheet is open and cache is invalid.
    if (isAbsencesSheetOpen && user && !isGeneratingAbsenceRec) {
        const isCacheValid = absenceRecommendationCache && (Date.now() - absenceRecommendationCache.timestamp < CACHE_DURATION);
        if (!isCacheValid) {
            const fetchRecommendation = async () => {
                setIsGeneratingAbsenceRec(true);
                try {
                    const rec = await getAbsenceAnalysis(absencesBySubject, user.first_name);
                    setAbsenceRecommendationCache({ data: rec, timestamp: Date.now() });
                } catch(e) {
                    console.error(e);
                    setAbsenceRecommendationCache({ data: "Не удалось получить персональный совет из-за ошибки.", timestamp: Date.now() });
                } finally {
                    setIsGeneratingAbsenceRec(false);
                }
            };
            fetchRecommendation();
        }
    }
  }, [isAbsencesSheetOpen, absenceRecommendationCache, absencesBySubject, user]);

  useEffect(() => {
    if (isLoading) return;

    const shouldShowWarning = subjectsWithManyAbsences.length > 0;
    
    if (shouldShowWarning) {
        setWarningVisible(true);
        const timer = setTimeout(() => {
            setWarningVisible(false);
        }, 10000); // Скрывать через 10 секунд

        // Очищаем таймер, если компонент размонтируется
        return () => clearTimeout(timer);
    } else {
        setWarningVisible(false);
    }
  }, [subjectsWithManyAbsences, isLoading]);


  const handleDismissWarning = () => {
      setWarningVisible(false);
  };
  
  const subjects = Object.keys(gradesBySubject).sort();
  
  if (isLoading) {
    return (
      <div className="animate-fade-in space-y-4">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="bg-secondary dark:bg-dark-secondary p-4 rounded-3xl animate-pulse h-20"></div>
        ))}
        {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-secondary dark:bg-dark-secondary p-4 rounded-3xl animate-pulse h-24"></div>
        ))}
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
        {error && (
            <div className="mb-6 p-4 bg-red-500/10 dark:bg-red-400/10 backdrop-blur-lg rounded-2xl border border-red-500/20 dark:border-red-400/20 text-center">
                <p className="text-sm text-red-800 dark:text-red-300 font-medium">{error}</p>
            </div>
        )}
        
        <div className={`transition-all duration-500 ease-in-out ${isWarningVisible ? 'max-h-96 opacity-100 mb-6' : 'max-h-0 opacity-0 mb-0 overflow-hidden'}`}>
            <div className="p-4 bg-red-500/10 dark:bg-red-400/10 backdrop-blur-xl rounded-3xl border border-red-500/20 dark:border-red-400/20 text-left relative">
                <button 
                    onClick={handleDismissWarning} 
                    className="absolute top-3 right-3 text-red-600/70 dark:text-red-300/70 hover:text-red-800 dark:hover:text-red-200 transition-colors"
                    aria-label="Закрыть предупреждение"
                >
                    <i className="ph-bold ph-x text-lg"></i>
                </button>
                <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 text-2xl text-red-600 dark:text-red-400 mt-0.5">
                        <i className="ph-bold ph-warning"></i>
                    </div>
                    <div>
                        <h4 className="font-bold text-red-900 dark:text-red-200">Академическая задолженность</h4>
                        <p className="text-sm text-red-800 dark:text-red-300 mt-1 mb-3">
                            Рекомендуется закрыть задолженности по следующим предметам:
                        </p>
                        <ul className="text-sm space-y-1.5 list-disc list-inside text-red-900 dark:text-red-200">
                            {subjectsWithManyAbsences.map(([subject, subjectAbsences]) => (
                                <li key={subject}>
                                    <span className="font-semibold">{subject}:</span> {subjectAbsences.length} {getPluralForm(subjectAbsences.length, 'отработка', 'отработки', 'отработок')}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6">
            {currentUserRank && currentUserRank.rank > 0 && (
                <div 
                  onClick={() => setRatingSheetOpen(true)} 
                  className="relative col-span-1 overflow-hidden transition-all duration-300 ease-in-out transform bg-white/40 dark:bg-dark-secondary/50 backdrop-blur-3xl p-4 rounded-3xl shadow-soft-lg dark:shadow-dark-soft-lg border border-white/30 dark:border-white/10 cursor-pointer hover:scale-105 active:scale-95"
                >
                  <span className="absolute bottom-[-10px] right-[-10px] text-7xl opacity-10 text-amber-500" role="img" aria-hidden="true">🏆</span>
                  
                  <div className="relative z-10 flex flex-col h-full">
                    <p className="font-bold text-text-primary dark:text-dark-text-primary text-sm">Рейтинг</p>
                    <div className="flex-grow flex flex-col justify-center">
                      <p className="text-3xl font-bold text-amber-600 dark:text-amber-400 mt-1">{currentUserRank.avg?.toFixed(2)}</p>
                      <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-1">{currentUserRank.rank} место из {rankedUsers.length}</p>
                    </div>
                  </div>
                </div>
            )}
             <div 
                onClick={() => setAbsencesSheetOpen(true)} 
                className="relative col-span-1 overflow-hidden transition-all duration-300 ease-in-out transform bg-white/40 dark:bg-dark-secondary/50 backdrop-blur-3xl p-4 rounded-3xl shadow-soft-lg dark:shadow-dark-soft-lg border border-white/30 dark:border-white/10 cursor-pointer hover:scale-105 active:scale-95"
            >
                <span className="absolute bottom-[-10px] right-[-10px] text-7xl opacity-10 text-red-500" role="img" aria-hidden="true">🗓️</span>
                
                <div className="relative z-10 flex flex-col h-full">
                  <p className="font-bold text-text-primary dark:text-dark-text-primary text-sm">Отработки</p>
                  <div className="flex-grow flex flex-col justify-center">
                    <div className="flex items-baseline mt-1">
                        <p className="text-3xl font-bold text-red-600 dark:text-red-400">{totalAbsences}</p>
                        <span className="text-xl font-bold text-text-secondary dark:text-dark-text-secondary ml-1">/ {userLectureAbsences.length}</span>
                    </div>
                    <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-1">Практики / Лекции</p>
                  </div>
                </div>
            </div>
        </div>

        {subjects.length > 0 ? (
            <div className="space-y-4">
                {subjects.map(subject => (
                    <SubjectGradeCard 
                        key={subject} 
                        subject={subject} 
                        grades={gradesBySubject[subject]}
                        cachedAnalysis={analyticsCache[subject]}
                        onAnalysisFetched={(recommendation) => {
                            setAnalyticsCache(prev => ({ ...prev, [subject]: { data: recommendation, timestamp: Date.now() } }));
                        }}
                    />
                ))}
            </div>
        ) : (
             <div className="text-center py-10">
                <p className="text-text-secondary dark:text-dark-text-secondary">Пока нет ни одной оценки.</p>
            </div>
        )}

        <BottomSheet isOpen={isRatingSheetOpen} onClose={() => setRatingSheetOpen(false)} title="Рейтинг группы">
             <div className="space-y-4">
                {isGeneratingRatingRec || !ratingRecommendationCache ? (
                     <div className="flex items-center justify-center space-x-2 p-4 rounded-xl">
                         <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                         <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                         <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                         <span className="text-sm text-text-secondary dark:text-dark-text-secondary">Анализирую рейтинг...</span>
                    </div>
                ) : (
                     <div className="flex items-start gap-3 p-1">
                        <div className="flex-shrink-0 w-8 h-8 mt-1 rounded-full bg-highlight dark:bg-dark-highlight flex items-center justify-center text-lg">
                            <i className="ph-bold ph-sparkle text-accent dark:text-dark-accent"></i>
                        </div>
                        <div className="w-full bg-secondary dark:bg-dark-secondary text-text-primary dark:text-dark-text-primary rounded-2xl rounded-bl-lg px-4 py-3 shadow-soft-subtle dark:shadow-dark-soft-subtle border border-border-color dark:border-dark-border-color">
                             <p className="text-sm leading-relaxed">{ratingRecommendationCache.data}</p>
                        </div>
                    </div>
                )}
                <ul className="space-y-2">
                    {rankedUsers.map((u) => (
                        <li key={u.id} className={`flex items-center justify-between p-3 rounded-xl transition-colors ${u.id === userId ? 'bg-accent/10 dark:bg-dark-accent/10 border border-accent/20' : 'bg-white/40 dark:bg-dark-secondary/50 border border-white/20 dark:border-white/5'}`}>
                            <div className="flex items-center">
                                <span className={`w-8 text-center font-bold text-sm ${u.id === userId ? 'text-accent dark:text-dark-accent' : 'text-text-secondary dark:text-dark-text-secondary'}`}>{u.rank}.</span>
                                <span className={`font-medium ${u.id === userId ? 'text-text-primary dark:text-dark-text-primary font-bold' : 'text-text-primary dark:text-dark-text-primary'}`}>{u.name}</span>
                            </div>
                            <span className={`font-bold text-sm ${u.id === userId ? 'text-accent dark:text-dark-accent' : 'text-text-primary dark:text-dark-text-primary'}`}>{u.avg?.toFixed(2)}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </BottomSheet>

        <BottomSheet isOpen={isAbsencesSheetOpen} onClose={() => { setAbsencesSheetOpen(false); setActiveAbsenceTab('practicals'); }} title="Все отработки">
            <div className="space-y-4">
                 {isGeneratingAbsenceRec || !absenceRecommendationCache ? (
                     <div className="flex items-center justify-center space-x-2 p-4 rounded-xl">
                         <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                         <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                         <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                         <span className="text-sm text-text-secondary dark:text-dark-text-secondary">Анализирую пропуски...</span>
                    </div>
                ) : (
                     <div className="flex items-start gap-3 p-1">
                        <div className="flex-shrink-0 w-8 h-8 mt-1 rounded-full bg-highlight dark:bg-dark-highlight flex items-center justify-center text-lg">
                            <i className="ph-bold ph-sparkle text-accent dark:text-dark-accent"></i>
                        </div>
                        <div className="w-full bg-secondary dark:bg-dark-secondary text-text-primary dark:text-dark-text-primary rounded-2xl rounded-bl-lg px-4 py-3 shadow-soft-subtle dark:shadow-dark-soft-subtle border border-border-color dark:border-dark-border-color">
                             <p className="text-sm leading-relaxed">{absenceRecommendationCache.data}</p>
                        </div>
                    </div>
                )}
                
                <div className="flex gap-3">
                    <button 
                        onClick={() => setActiveAbsenceTab('practicals')} 
                        className={`flex-1 py-1.5 px-4 rounded-xl text-sm font-bold transition-all duration-300 backdrop-blur-sm border dark:border-white/10 ${activeAbsenceTab === 'practicals' ? 'bg-white/70 dark:bg-white/20 text-accent dark:text-dark-accent shadow-soft' : 'bg-white/30 dark:bg-white/10 text-text-secondary dark:text-dark-text-secondary hover:bg-white/50 dark:hover:bg-white/15'}`}
                    >
                        Практики ({totalAbsences})
                    </button>
                    <button 
                        onClick={() => setActiveAbsenceTab('lectures')} 
                        className={`flex-1 py-1.5 px-4 rounded-xl text-sm font-bold transition-all duration-300 backdrop-blur-sm border dark:border-white/10 ${activeAbsenceTab === 'lectures' ? 'bg-white/70 dark:bg-white/20 text-accent dark:text-dark-accent shadow-soft' : 'bg-white/30 dark:bg-white/10 text-text-secondary dark:text-dark-text-secondary hover:bg-white/50 dark:hover:bg-white/15'}`}
                    >
                        Лекции ({userLectureAbsences.length})
                    </button>
                </div>
                
                {activeAbsenceTab === 'practicals' && (
                    Object.keys(absencesBySubject).length > 0 ? (
                        <div className="space-y-4">
                            {Object.entries(absencesBySubject).map(([subject, subjectAbsences]) => {
                                const absencesCount = (subjectAbsences as SubjectGrade[]).length;
                                const hasManyAbsences = absencesCount >= 5;
                                return (
                                    <div key={subject}>
                                        <div className="flex justify-between items-center mb-2">
                                            <h4 className={`font-bold ${hasManyAbsences ? 'text-red-600 dark:text-red-400' : 'text-text-primary dark:text-dark-text-primary'}`}>{subject}</h4>
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${hasManyAbsences ? 'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-500' : 'bg-highlight dark:bg-dark-highlight text-text-secondary dark:text-dark-text-secondary'}`}>
                                                {absencesCount} {getPluralForm(absencesCount, 'отработка', 'отработки', 'отработок')}
                                            </span>
                                        </div>
                                        <ul className="space-y-2">
                                            {[...(subjectAbsences as SubjectGrade[])].reverse().map((absence, index) => (
                                                <li key={index} className="flex justify-between items-center bg-white/40 dark:bg-dark-secondary/50 px-3 py-2 rounded-xl border border-white/20 dark:border-white/5">
                                                    <div className="min-w-0 pr-2">
                                                        <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary break-words">{absence.topic}</p>
                                                        <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-0.5">
                                                            {new Date(absence.date).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                                                        </p>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="text-center text-text-secondary dark:text-dark-text-secondary py-8">Пропусков практик нет, так держать!</p>
                    )
                )}

                {activeAbsenceTab === 'lectures' && (
                    Object.keys(lectureAbsencesBySubject).length > 0 ? (
                        <div className="space-y-4">
                            {Object.entries(lectureAbsencesBySubject).map(([subject, subjectAbsences]) => (
                                <div key={subject}>
                                    <h4 className="font-bold text-text-primary dark:text-dark-text-primary mb-2">{subject}</h4>
                                    <ul className="space-y-2">
                                        {(subjectAbsences as SubjectGrade[]).map((absence, index) => (
                                            <li key={index} className="flex justify-between items-center bg-white/40 dark:bg-dark-secondary/50 px-3 py-2 rounded-xl border border-white/20 dark:border-white/5">
                                                <div className="min-w-0 pr-2">
                                                    <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary break-words">{absence.topic}</p>
                                                    <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-0.5">
                                                        {new Date(absence.date).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                                                    </p>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-center text-text-secondary dark:text-dark-text-secondary py-8">Пропусков лекций нет, отлично!</p>
                    )
                )}
            </div>
        </BottomSheet>
    </div>
  );
};

export default Grades;