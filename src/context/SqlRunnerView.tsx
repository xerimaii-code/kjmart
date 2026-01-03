
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAlert, useMiscUI, useDeviceSettings, useDataState } from '../context/AppContext';
import { SpinnerIcon, TrashIcon, PencilSquareIcon, PlayCircleIcon, BookmarkSquareIcon, StopCircleIcon, SparklesIcon, StarIcon, ClipboardIcon, DragHandleIcon, CalendarIcon, ChevronDownIcon, DocumentIcon } from '../components/Icons';
import { querySql, naturalLanguageToSql, aiChat, QuerySqlResponse, executeUserQuery } from '../services/sqlService';
import { addUserQuery, deleteUserQuery, updateUserQuery } from '../services/dbService';
import { getCachedSchema } from '../services/schemaService';
import { getLearningContext } from '../services/learningService';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';
import ActionModal from '../components/ActionModal';
import ToggleSwitch from '../components/ToggleSwitch';
import { UserQuery } from '../types';

// ... (이하 코드 동일)
