# scripts\visualize_graph.py
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.graph.workflow import app_graph

def save_graph_image():
    try:
        # 그래프를 mermaid 형식의 png로 생성
        img_data = app_graph.get_graph().draw_mermaid_png()
        
        with open("graph_flow.png", "wb") as f:
            f.write(img_data)
        print("✅ 그래프 이미지가 'graph_flow.png'로 저장되었습니다.")
    except Exception as e:
        print(f"❌ 시각화 실패 (pygraphviz 등 추가 라이브러리 필요할 수 있음): {e}")
        # 이미지 생성이 안 되면 텍스트(Mermaid)로 출력
        print("\n[Mermaid Graph Definition]")
        print(app_graph.get_graph().draw_mermaid())

if __name__ == "__main__":
    save_graph_image()