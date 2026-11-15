
let sb;
let lessons = [];
let current = null;
let manualAccess = false;
let allowedLessons = new Set();

const $ = id => document.getElementById(id);

const courseId = new URLSearchParams(location.search).get('id');

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    sb = window.supabase.createClient(
      APP_CONFIG.SUPABASE_URL,
      APP_CONFIG.SUPABASE_ANON_KEY
    );

    const { data: { session }, error: sessionError } =
      await sb.auth.getSession();

    if (sessionError) throw sessionError;

    if (!session) {
      location.href = 'login.html';
      return;
    }

    if (!courseId) {
      location.href = 'aluno.html';
      return;
    }

    $('feedback').textContent = 'Verificando acesso ao curso...';

    // VERIFICA SE O ALUNO COMPROU O CURSO
    const { data: paid, error: paidError } = await sb
      .from('my_course_access')
      .select('course_id,title')
      .eq('course_id', courseId)
      .maybeSingle();

    if (paidError) throw paidError;

    let courseTitle = paid?.title || null;

    // VERIFICA SE EXISTEM AULAS LIBERADAS MANUALMENTE
    const { data: manual, error: manualError } =
      await sb.functions.invoke('gestao-acessos', {
        body: {
          action: 'my-manual-courses'
        }
      });

    if (manualError) throw manualError;
    if (manual?.error) throw new Error(manual.error);

    const manualCourse = (manual?.courses || []).find(
      c => String(c.course_id) === String(courseId)
    );

    manualAccess = !!manualCourse;

    if (!courseTitle && manualCourse) {
      courseTitle = manualCourse.title;
    }

    if (!paid && !manualAccess) {
      $('feedback').textContent =
        'Este curso ainda não está liberado para sua conta.';
      return;
    }

    $('tituloCurso').textContent = courseTitle || 'Meu curso';

    // BUSCA AS AULAS DO CURSO
    const { data, error } = await sb
      .from('lessons')
      .select('id,title,description,position')
      .eq('course_id', courseId)
      .eq('active', true)
      .order('position');

    if (error) throw error;

    const allLessons = data || [];

    if (!allLessons.length) {
      $('listaAulas').textContent =
        'As aulas ainda serão publicadas.';
      return;
    }

    // CURSO COMPRADO: TODAS AS AULAS ATIVAS
    if (paid) {
      lessons = allLessons;
      allowedLessons = new Set(
        allLessons.map(l => String(l.id))
      );
    } else {
      // ACESSO MANUAL: SOMENTE AS AULAS LIBERADAS
      const { data: grants, error: grantsError } = await sb
        .from('manual_lesson_access')
        .select('lesson_id')
        .eq('user_id', session.user.id)
        .eq('active', true);

      if (grantsError) throw grantsError;

      allowedLessons = new Set(
        (grants || []).map(g => String(g.lesson_id))
      );

      lessons = allLessons;
    }

    renderLessons();

    await loadCoursePdfs();

    $('concluir').onclick = markComplete;

    $('feedback').textContent = manualAccess && !paid
      ? 'Você tem acesso às aulas liberadas pelo administrador.'
      : 'Curso liberado. Escolha uma aula para começar.';

  } catch (error) {
    console.error('Erro ao abrir curso:', error);
    $('feedback').textContent =
      'Não foi possível carregar o curso: ' + error.message;
  }
}

function renderLessons() {
  const box = $('listaAulas');
  box.innerHTML = '';

  lessons.forEach((lesson, i) => {
    const allowed = allowedLessons.has(String(lesson.id));

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lesson-row';
    b.style.width = '100%';
    b.style.textAlign = 'left';

    b.textContent = allowed
      ? `Aula ${i + 1} — ${lesson.title}`
      : `🔒 Aula ${i + 1} — ${lesson.title} (Bloqueada)`;

    b.disabled = !allowed;

    if (!allowed) {
      b.style.opacity = '0.55';
      b.style.cursor = 'not-allowed';
    } else {
      b.onclick = () => play(lesson);
    }

    box.append(b);
  });
}

async function play(lesson) {
  if (!allowedLessons.has(String(lesson.id))) {
    $('feedback').textContent =
      'Esta aula ainda não foi liberada para sua conta.';
    return;
  }

  current = lesson;

  $('tituloAula').textContent = lesson.title;
  $('descricaoAula').textContent = lesson.description || '';
  $('feedback').textContent = 'Verificando autorização do vídeo...';
  $('concluir').disabled = true;

  const { data, error } = await sb.functions.invoke('url-video', {
    body: {
      lesson_id: lesson.id
    }
  });

  if (error || !data?.url) {
    $('feedback').textContent =
      error?.message || data?.error ||
      'Não foi possível abrir esta aula.';
    return;
  }

  const player = $('player');
  player.src = data.url;
  player.load();

  player.play().catch(() => {});

  $('concluir').disabled = false;

  $('feedback').textContent =
    'Aula liberada. Assista ao conteúdo e marque como concluída ao terminar.';
}

async function markComplete() {
  if (!current) return;

  const player = $('player');

  if (!player.duration ||
      player.currentTime / player.duration < 0.9) {
    $('feedback').textContent =
      'Assista a pelo menos 90% do vídeo antes de marcar a aula como concluída.';
    return;
  }

  $('concluir').disabled = true;

  const { error } = await sb
    .from('lesson_progress')
    .upsert({
      lesson_id: current.id,
      completed: true,
      completed_at: new Date().toISOString()
    }, {
      onConflict: 'user_id,lesson_id'
    });

  if (error) {
    $('feedback').textContent =
      'Não foi possível salvar o progresso: ' + error.message;
    $('concluir').disabled = false;
    return;
  }

  $('feedback').textContent =
    'Aula registrada como concluída!';
}

async function loadCoursePdfs() {
  const box = $('listaPdfsCurso');
  if (!box) return;

  const { data, error } = await sb
    .from('course_pdfs')
    .select('id,title,description')
    .eq('course_id', courseId)
    .eq('active', true)
    .order('created_at', { ascending: true });

  box.innerHTML = '';

  if (error) {
    box.textContent =
      'Não foi possível carregar os materiais: ' + error.message;
    return;
  }

  if (!data?.length) {
    box.textContent =
      'Ainda não há materiais em PDF neste curso.';
    return;
  }

  data.forEach(pdf => {
    const item = document.createElement('div');
    item.className = 'pdf-student-item';

    const title = document.createElement('strong');
    title.textContent = pdf.title;

    const desc = document.createElement('p');
    desc.textContent =
      pdf.description || 'Material complementar do curso.';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-outline';
    button.textContent = 'Abrir / baixar PDF';

    button.onclick = async () => {
      button.disabled = true;
      button.textContent = 'Preparando arquivo...';

      const { data: result, error: invokeError } =
        await sb.functions.invoke('url-pdf', {
          body: {
            pdf_id: pdf.id
          }
        });

      if (invokeError || !result?.url) {
        alert(
          invokeError?.message || result?.error ||
          'Não foi possível abrir o PDF.'
        );
      } else {
        window.open(result.url, '_blank', 'noopener');
      }

      button.disabled = false;
      button.textContent = 'Abrir / baixar PDF';
    };

    item.append(title, desc, button);
    box.append(item);
  });
}
