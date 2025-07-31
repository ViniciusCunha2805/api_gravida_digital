document.addEventListener('DOMContentLoaded', () => {
    const tabela = document.querySelector('#tabela-dados tbody');
    const btnAtualizar = document.getElementById('atualizar');

    async function carregarDados() {
        try {
            const response = await fetch('/api/dados');
            const dados = await response.json();
            
            tabela.innerHTML = ''; // Limpa a tabela
            
            dados.forEach(item => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${item.id_usuario}</td>
                    <td>${item.nome}</td>
                    <td>${item.email}</td>
                    <td>${item.id_secao || 'N/A'}</td>
                    <td>${item.data_realizacao}</td>
                    <td>
                        ${item.id_secao ? 
                            `<a href="/download-secao?secao=${item.id_secao}" class="download-btn">Baixar ZIP</a>` : 
                            'N/A'}
                    </td>
                `;
                tabela.appendChild(row);
            });
        } catch (error) {
            console.error('Erro ao carregar dados:', error);
        }
    }

    btnAtualizar.addEventListener('click', carregarDados);
    carregarDados(); // Carrega os dados inicialmente

    const btnLimpar = document.getElementById('limpar-tabelas');

    btnLimpar.addEventListener('click', async () => {
        if (!confirm("Tem certeza que deseja limpar TODAS as seções? Essa ação é irreversível.")) return;

        try {
            const response = await fetch('/admin/limpar-tabelas', { method: 'POST' });
            const resultado = await response.json();

            alert(resultado.message || "Tabelas limpas!");
            carregarDados(); // Atualiza a tabela na tela
        } catch (error) {
            console.error('Erro ao limpar tabelas:', error);
            alert("Erro ao tentar limpar as tabelas.");
        }
    });

});