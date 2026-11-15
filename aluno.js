
let sb;

const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
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

    $('nomeAluno').textContent =
      session.user.user_metadata?.full_name ||
      session.user.email;

    $('sair').onclick = async e => {
      e.preventDefault();
      await sb.auth.signOut();
      location.href = 'index.html';
    };

    const box = $('meusCursos');

    box.textContent = 'Carregando seus cursos...';

    // CURSOS COMPRADOS
    const { data: purchased, error: purchaseError } =
      await sb
        .from('my_course_access')
        .select(
          'course_id,title,description,price,progress_percent'
        );

    if (purchaseError) throw purchaseError;

    // CURSOS COM AULAS LIBERADAS GRATUITAMENTE
    const { data: manual, error: manualError } =
      await sb.functions.invoke('gestao-acessos', {
        body: {
          action: 'my-manual-courses'
        }
      });

    if (manualError) {
      console.error(
        'Erro ao consultar liberações gratuitas:',
        manualError
      );
      throw new Error(
        'Não foi possível consultar suas liberações gratuitas: ' +
        manualError.message
      );
    }

    if (manual?.error) {
      throw new Error(manual.error);
    }

    // UNIR OS DOIS TIPOS DE ACESSO
    const cursos = new Map();

    (purchased || []).forEach(c => {
      cursos.set(String(c.course_id), c);
    });

    (manual?.courses || []).forEach(c => {
      const id = String(c.course_id);

      // Não substitui o progresso de um curso comprado.
      if (!cursos.has(id)) {
        cursos.set(id, c);
      }
    });

    const lista = [...cursos.values()];

    if (!lista.length) {
      box.innerHTML =
        '<p class="empty">Você ainda não tem cursos liberados. ' +
        '<a href="index.html#cursos">Conheça os cursos disponíveis.</a></p>';
      return;
    }

    box.innerHTML = '';

    lista.forEach(c => {
      const card = document.createElement('article');
      card.className = 'course-card';

      const body = document.createElement('div');
      body.className = 'course-body';

      const h = document.createElement('h3');
      h.textContent = c.title;

      const p = document.createElement('p');
      p.textContent =
        c.description || 'Continue seus estudos.';

      const pct = Math.min(
        100,
        Math.max(0, Number(c.progress_percent) || 0)
      );

      const label = document.createElement('p');
      label.textContent = `Progresso: ${pct}%`;

      const bar = document.createElement('div');
      bar.className = 'progress';

      const fill = document.createElement('span');
      fill.style.width = pct + '%';

      bar.append(fill);

      const a = document.createElement('a');
      a.className = 'btn';
      a.href =
        'curso.html?id=' + encodeURIComponent(c.course_id);
      a.textContent = 'Assistir às aulas';

      body.append(h, p, label, bar, a);
      card.append(body);
      box.append(card);
    });

  } catch (error) {
    console.error('Erro na área do aluno:', error);

    $('meusCursos').textContent =
      'Não foi possível carregar seus cursos: ' +
      error.message;
  }
});
